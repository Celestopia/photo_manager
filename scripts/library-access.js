const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  DATA_FILE_NAMES,
  assertPathInsideLibrary,
  assertDirectoryWritable,
  findNestedManagerDirectory,
  findParentManagerDirectory,
  readLibraryManifest,
} = require("./library-core");
const { acquireLibraryLock, readLock, releaseLibraryLock } = require("./library-lock");

async function validateExistingLibrary(paths, options = {}) {
  const stat = await fsp.stat(paths.root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Library directory does not exist: ${paths.root}`);
  const rootLinkStat = await fsp.lstat(paths.root);
  if (rootLinkStat.isSymbolicLink()) throw new Error("A symbolic-link directory cannot be used as a library root");
  const parentManager = findParentManagerDirectory(paths.root);
  if (parentManager) throw new Error(`The selected directory is inside another PhotoManager library: ${parentManager}`);
  const manifest = await readLibraryManifest(paths);
  for (const fileName of Object.values(DATA_FILE_NAMES)) {
    const filePath = path.join(paths.dataDir, fileName);
    if (!fs.existsSync(filePath)) throw new Error(`Missing required data file: ${fileName}`);
  }
  await assertDirectoryWritable(paths.managerDir);
  if (options.detectNested !== false) {
    const nested = await findNestedManagerDirectory(paths.root, options.onProgress);
    if (nested) throw new Error(`Nested PhotoManager library detected: ${nested}`);
  }
  return manifest;
}

async function authorizeLibraryOperation(paths, manifest, options = {}) {
  const parentSessionId = options.parentSessionId || process.env.PHOTO_MANAGER_LIBRARY_SESSION || "";
  if (parentSessionId) {
    const lock = await readLock(paths.lockFile);
    if (!lock || lock.SessionId !== parentSessionId || lock.LibraryId !== manifest.libraryId) {
      const error = new Error("The parent application no longer owns this library lock");
      error.code = "LIBRARY_SESSION_CHANGED";
      throw error;
    }
    return { lock, ownsLock: false, release: async () => false };
  }
  const lock = await acquireLibraryLock(paths, manifest);
  return {
    lock,
    ownsLock: true,
    release: () => releaseLibraryLock(paths, lock.SessionId),
  };
}

function validateMetadataPaths(paths, items) {
  for (const item of items) {
    if (!item?.FilePath) throw new Error("Metadata contains an empty FilePath");
    assertPathInsideLibrary(paths, path.join(paths.root, item.FilePath));
  }
}

module.exports = { validateExistingLibrary, authorizeLibraryOperation, validateMetadataPaths };
