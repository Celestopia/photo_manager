/**
 * Shared library boundary and persistence primitives.
 *
 * A library is a user-selected media root. All PhotoManager-owned data for that
 * root lives under <root>/.photo_manager and is resolved exclusively here.
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const yaml = require("js-yaml");

const LIBRARY_SCHEMA_VERSION = 2;
const MANAGER_DIR_NAME = ".photo_manager";
const DATA_FILE_NAMES = Object.freeze({
  metadata: "photo_metadata.jsonl",
  tags: "tag_registry.jsonl",
  albums: "album_registry.jsonl",
  people: "person_registry.jsonl",
  locations: "location_registry.jsonl",
});

function normalizeLibraryName(value) {
  const name = String(value || "").trim();
  if (!name || name.length > 100) throw new Error("Library name must contain 1-100 characters");
  return name;
}

function resolveLibraryPaths(rawRoot) {
  if (!rawRoot) throw new Error("A library path is required");
  const root = path.resolve(String(rawRoot));
  if (path.parse(root).root === root) throw new Error("A drive root cannot be used as a library");
  const managerDir = path.join(root, MANAGER_DIR_NAME);
  const dataDir = path.join(managerDir, "data");
  return {
    root,
    managerDir,
    manifestFile: path.join(managerDir, "library.yml"),
    lockFile: path.join(managerDir, "library.lock"),
    initializationFile: path.join(managerDir, "initialization.json"),
    transactionFile: path.join(managerDir, "transaction.json"),
    transactionDir: path.join(managerDir, "temp", "transactions"),
    dataDir,
    metadataFile: path.join(dataDir, DATA_FILE_NAMES.metadata),
    thumbnailDir: path.join(managerDir, "thumb_cache"),
    thumbnailManifestFile: path.join(managerDir, "thumb_cache", "cache_manifest.json"),
    backupDir: path.join(managerDir, "backups"),
    logDir: path.join(managerDir, "logs"),
    tempDir: path.join(managerDir, "temp"),
  };
}

function dataFilePath(paths, fileName) {
  return path.join(paths.dataDir, fileName);
}

function assertPathInsideLibrary(paths, candidate) {
  const absolute = path.resolve(candidate);
  const relative = path.relative(paths.root, absolute);
  if (!relative || relative === MANAGER_DIR_NAME || relative.startsWith(`${MANAGER_DIR_NAME}${path.sep}`)) {
    throw new Error("The path refers to PhotoManager-owned data, not a media file");
  }
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("The media path escapes the active library");
  }
  let current = paths.root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Symbolic-link media paths are not supported");
  }
  if (fs.existsSync(absolute)) {
    const realRoot = fs.realpathSync(paths.root);
    const realCandidate = fs.realpathSync(absolute);
    const realRelative = path.relative(realRoot, realCandidate);
    if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      throw new Error("The resolved media path escapes the active library");
    }
  }
  return absolute;
}

function createLibraryManifest(root, name = path.basename(path.resolve(root))) {
  const now = new Date().toISOString();
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    libraryId: crypto.randomUUID(),
    name: normalizeLibraryName(name),
    createdAt: now,
    updatedAt: now,
  };
}

function validateLibraryManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("library.yml must contain an object");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value.libraryId || ""))) {
    throw new Error("library.yml contains an invalid libraryId");
  }
  const manifest = {
    schemaVersion: Number.isInteger(value.schemaVersion) ? value.schemaVersion : LIBRARY_SCHEMA_VERSION,
    libraryId: String(value.libraryId),
    name: normalizeLibraryName(value.name),
    createdAt: String(value.createdAt || ""),
    updatedAt: String(value.updatedAt || ""),
  };
  if (!Number.isFinite(Date.parse(manifest.createdAt)) || !Number.isFinite(Date.parse(manifest.updatedAt))) {
    throw new Error("library.yml contains an invalid timestamp");
  }
  return manifest;
}

async function readLibraryManifest(paths) {
  let parsed;
  try {
    parsed = yaml.load(await fsp.readFile(paths.manifestFile, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read library.yml: ${error.message}`);
  }
  return validateLibraryManifest(parsed);
}

async function writeLibraryManifest(paths, manifest) {
  const normalized = validateLibraryManifest(manifest);
  await writeTextAtomic(paths.manifestFile, yaml.dump(normalized, { noRefs: true, lineWidth: 120 }));
  return normalized;
}

async function ensureLibraryDirectories(paths) {
  for (const directory of [paths.managerDir, paths.dataDir, paths.thumbnailDir, paths.backupDir, paths.logDir, paths.tempDir, paths.transactionDir]) {
    await fsp.mkdir(directory, { recursive: true });
  }
}

async function assertDirectoryWritable(directory) {
  const probe = path.join(directory, `.photo-manager-write-test-${process.pid}-${crypto.randomUUID()}.tmp`);
  try {
    await fsp.writeFile(probe, "ok", { flag: "wx" });
  } finally {
    await fsp.rm(probe, { force: true }).catch(() => {});
  }
}

async function writeTextAtomic(filePath, text) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fsp.writeFile(temp, text, "utf8");
    await fsp.rename(temp, filePath);
  } finally {
    await fsp.rm(temp, { force: true }).catch(() => {});
  }
}

async function readJsonlStrict(filePath, options = {}) {
  const { required = true, keyOf = null, label = path.basename(filePath) } = options;
  if (!fs.existsSync(filePath)) {
    if (required) throw new Error(`Missing required data file: ${label}`);
    return [];
  }
  const content = await fsp.readFile(filePath, "utf8");
  const output = [];
  const seen = new Set();
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;
    let item;
    try {
      item = JSON.parse(lines[index]);
    } catch (error) {
      throw new Error(`${label}:${index + 1} contains invalid JSON (${error.message})`);
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${label}:${index + 1} must contain an object`);
    if (keyOf) {
      const key = keyOf(item);
      if (typeof key !== "string" || !key) throw new Error(`${label}:${index + 1} is missing its unique key`);
      if (seen.has(key)) throw new Error(`${label} contains duplicate key: ${key}`);
      seen.add(key);
    }
    output.push(item);
  }
  return output;
}

async function writeJsonlAtomic(filePath, entries) {
  const lines = [...entries].map((entry) => JSON.stringify(entry));
  await writeTextAtomic(filePath, `${lines.join("\n")}${lines.length ? "\n" : ""}`);
}

function parseLibraryArgument(argv = process.argv.slice(2)) {
  const index = argv.indexOf("--library");
  if (index < 0 || !argv[index + 1] || argv[index + 1].startsWith("--")) {
    throw new Error('Missing required argument: --library "<path>"');
  }
  return resolveLibraryPaths(path.resolve(process.cwd(), argv[index + 1]));
}

async function findNestedManagerDirectory(root, onProgress = null, isCancelled = null) {
  const stack = [path.resolve(root)];
  let visited = 0;
  while (stack.length) {
    if (isCancelled?.()) {
      const error = new Error("Operation cancelled");
      error.code = "OPERATION_CANCELLED";
      throw error;
    }
    const current = stack.pop();
    const entries = await fsp.readdir(current, { withFileTypes: true });
    visited += 1;
    onProgress?.({ phase: "scan-directories", visited, current });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (!entry.isDirectory()) continue;
      const full = path.join(current, entry.name);
      if (entry.name === MANAGER_DIR_NAME) {
        if (path.resolve(current) !== path.resolve(root)) return full;
        continue;
      }
      stack.push(full);
    }
  }
  return null;
}

function findParentManagerDirectory(root) {
  let current = path.dirname(path.resolve(root));
  while (true) {
    const manager = path.join(current, MANAGER_DIR_NAME);
    if (fs.existsSync(manager)) return manager;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

module.exports = {
  LIBRARY_SCHEMA_VERSION,
  MANAGER_DIR_NAME,
  DATA_FILE_NAMES,
  normalizeLibraryName,
  resolveLibraryPaths,
  dataFilePath,
  assertPathInsideLibrary,
  createLibraryManifest,
  validateLibraryManifest,
  readLibraryManifest,
  writeLibraryManifest,
  ensureLibraryDirectories,
  assertDirectoryWritable,
  writeTextAtomic,
  readJsonlStrict,
  writeJsonlAtomic,
  parseLibraryArgument,
  findNestedManagerDirectory,
  findParentManagerDirectory,
};
