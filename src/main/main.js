/**
 * Electron main-process entry.
 *
 * Responsibilities:
 * 1) Load and normalize runtime configuration.
 * 2) Load photo metadata index (JSONL -> in-memory Map).
 * 3) Serve IPC handlers for query/update/copy/window actions.
 * 4) Create and monitor the renderer window.
 */
const { app, BrowserWindow, ipcMain, clipboard, nativeImage, shell, dialog } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const yaml = require("js-yaml");
const { fork } = require("node:child_process");
const {
  normalizeThumbnailConfig,
  thumbnailAbsolutePath,
  ensureThumbnailsForItems,
} = require(path.join(__dirname, "..", "..", "scripts", "thumbnail-cache.js"));
const {
  DEFAULT_MEDIA_CONFIG,
  normalizeMediaConfig,
  validateMediaTools,
  sanitizeMediaError,
} = require(path.join(__dirname, "..", "..", "scripts", "media-tools.js"));
const {
  DATA_FILE_NAMES,
  resolveLibraryPaths,
  readLibraryManifest,
  writeLibraryManifest,
  normalizeLibraryName,
  readJsonlStrict,
  writeJsonlAtomic,
  writeTextAtomic,
  assertPathInsideLibrary,
  findNestedManagerDirectory,
  findParentManagerDirectory,
} = require(path.join(__dirname, "..", "..", "scripts", "library-core.js"));
const { validateExistingLibrary } = require(path.join(__dirname, "..", "..", "scripts", "library-access.js"));
const {
  acquireLibraryLock,
  releaseLibraryLock,
  inspectLibraryLock,
} = require(path.join(__dirname, "..", "..", "scripts", "library-lock.js"));
const { createLibraryBackup } = require(path.join(__dirname, "..", "..", "scripts", "library-backup.js"));
const {
  recoverPendingTransaction,
  commitJsonlTransaction,
} = require(path.join(__dirname, "..", "..", "scripts", "library-transaction.js"));
const {
  buildThumbnailManifest,
  thumbnailManifestMatches,
} = require(path.join(__dirname, "..", "..", "scripts", "build-thumbnails.js"));
const {
  walkFiles,
  extensionType,
} = require(path.join(__dirname, "..", "..", "scripts", "common.js"));

const APP_ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_PATH = path.join(APP_ROOT, "config.yml");
const RENDERER_INDEX_PATH = path.join(APP_ROOT, "dist", "renderer", "index.html");
const DEFAULT_CONFIG = {
  thumbnail: {
    size: 320,
    webpQuality: 80,
    extremeAspectRatio: 4,
    maxConcurrency: 4,
  },
  media: { ...DEFAULT_MEDIA_CONFIG },
  backup: { retentionCount: 10 },
  ui: {
    language: "zh-CN",
    gallery: {
      pageSize: 120,
      minCardWidth: 190,
    },
    viewer: {
      panelRatio: {
        left: 1,
        center: 3,
        right: 1,
      },
      panels: {
        showLeft: true,
        showRight: true,
      },
      zoom: {
        minPercent: 10,
        maxPercent: 1000,
        stepPercent: 10,
      },
    },
  },
};

// Runtime singletons in the main process.
let mainWindow = null;
let config = null;
let metadataIndex = new Map();
let tagRegistryIndex = new Map();
let albumRegistryIndex = new Map();
let personRegistryIndex = new Map();
let locationRegistryIndex = new Map();
let thumbnailWarmupStarted = false;
let thumbnailWarmupToken = null;
let activeLibrary = null;
let mediaToolsState = { available: false, error: "尚未检查媒体工具", versions: null };
let maintenanceState = { running: false, operation: "", progress: null, report: null };
let activeWorker = null;
let activeWorkerOperation = "";
let pendingAppClose = false;
let appState = { lastLibraryPath: "" };
let applicationStartedAt = new Date().toISOString();
let quickScanState = null;
const DEFAULT_TAG_DESCRIPTION = "待补充：请填写该标签的明确含义。";
const DEFAULT_ALBUM_DESCRIPTION = "待补充：请填写该相册的明确含义。";
const UNASSIGNED_ALBUM_FILTER = "__UNASSIGNED__";

/**
 * Force value into plain JSON-serializable structure.
 * This avoids IPC structured-clone failures when Vue/reactive objects leak in.
 */
function toSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Ensure config exists and always produce a fully merged config object.
 * If config file is invalid, fallback to defaults and log the issue.
 */
function ensureConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, yaml.dump(DEFAULT_CONFIG), "utf8");
    config = structuredClone(DEFAULT_CONFIG);
    return;
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = yaml.load(raw);
    config = {
      thumbnail: {
        ...DEFAULT_CONFIG.thumbnail,
        ...(parsed?.thumbnail || {}),
      },
      media: normalizeMediaConfig(parsed?.media),
      backup: {
        retentionCount: Math.max(1, Math.trunc(Number(parsed?.backup?.retentionCount) || DEFAULT_CONFIG.backup.retentionCount)),
      },
      ui: {
        ...DEFAULT_CONFIG.ui,
        ...(parsed?.ui || {}),
        gallery: {
          ...DEFAULT_CONFIG.ui.gallery,
          ...(parsed?.ui?.gallery || {}),
        },
        viewer: {
          ...DEFAULT_CONFIG.ui.viewer,
          ...(parsed?.ui?.viewer || {}),
          panelRatio: {
            ...DEFAULT_CONFIG.ui.viewer.panelRatio,
            ...(parsed?.ui?.viewer?.panelRatio || {}),
          },
          panels: {
            ...DEFAULT_CONFIG.ui.viewer.panels,
            ...(parsed?.ui?.viewer?.panels || {}),
          },
          zoom: {
            ...DEFAULT_CONFIG.ui.viewer.zoom,
            ...(parsed?.ui?.viewer?.zoom || {}),
          },
        },
      },
    };
  } catch (error) {
    config = structuredClone(DEFAULT_CONFIG);
    appendLog(`Invalid config.yml, fallback to default. ${error.message}`);
  }
}

/**

 * Check whether a value is a plain object (object literal style).

 * Used by deepMerge to avoid recursing into arrays or primitive values.

 */

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

/**

 * Recursively merge patch fields into a base object.

 * This keeps nested config sections intact when updating only part of config.yml.

 */

function deepMerge(base, patch) {
  const output = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

/**

 * Persist current in-memory config to config.yml.

 * Called after app:update-config succeeds in merging a patch.

 */

async function saveConfig() {
  const raw = yaml.dump(config);
  await fsp.writeFile(CONFIG_PATH, raw, "utf8");
}

function resolveDataDir() {
  if (!activeLibrary) {
    const error = new Error("No library is open");
    error.code = "LIBRARY_NOT_OPEN";
    throw error;
  }
  return activeLibrary.paths.dataDir;
}

function resolveDataFile(fileName) {
  return path.join(resolveDataDir(), fileName);
}

/**
 * Append one line into date-partitioned log file under configured log directory.
 */
function appendLog(message) {
  try {
    const logDir = activeLibrary?.paths?.logDir || path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const dayKey = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(path.join(logDir, `${dayKey}.log`), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Ignore logging failures to avoid crash loops.
  }
}

function appendOperationLog(operation, root, message) {
  if (operation !== "initialize") {
    appendLog(message);
    return;
  }
  try {
    const paths = resolveLibraryPaths(root);
    if (!fs.existsSync(paths.managerDir)) {
      appendLog(message);
      return;
    }
    fs.mkdirSync(paths.logDir, { recursive: true });
    const dayKey = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(path.join(paths.logDir, `${dayKey}.log`), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    appendLog(message);
  }
}

function appStateFile() {
  return path.join(app.getPath("userData"), "state.json");
}

async function loadAppState() {
  try {
    const parsed = JSON.parse(await fsp.readFile(appStateFile(), "utf8"));
    appState = { lastLibraryPath: typeof parsed?.lastLibraryPath === "string" ? parsed.lastLibraryPath : "" };
  } catch {
    appState = { lastLibraryPath: "" };
  }
}

async function saveAppState() {
  await fsp.mkdir(path.dirname(appStateFile()), { recursive: true });
  const temp = `${appStateFile()}.tmp`;
  await fsp.writeFile(temp, `${JSON.stringify(appState, null, 2)}\n`, "utf8");
  await fsp.rename(temp, appStateFile());
}

function requireOpenLibrary({ writable = false } = {}) {
  if (!activeLibrary || activeLibrary.state !== "open") {
    const error = new Error("No library is open");
    error.code = "LIBRARY_NOT_OPEN";
    throw error;
  }
  if (writable && maintenanceState.running) {
    const error = new Error("The library is read-only while maintenance is running");
    error.code = "MAINTENANCE_RUNNING";
    throw error;
  }
  return activeLibrary;
}

/**
 * Read metadata JSONL into an in-memory Map keyed by FilePath.
 * Strict parsing deliberately rejects malformed or duplicate records so an
 * inconsistent library never opens as if it were healthy.
 */
async function loadMetadataIndex() {
  metadataIndex.clear();
  const metadataFile = resolveDataFile(DATA_FILE_NAMES.metadata);
  const entries = await readJsonlStrict(metadataFile, {
    label: DATA_FILE_NAMES.metadata,
    keyOf: (item) => item?.FilePath,
  });
  for (const item of entries) {
    assertPathInsideLibrary(activeLibrary.paths, path.join(activeLibrary.paths.root, item.FilePath));
    metadataIndex.set(item.FilePath, item);
  }
}

/**
 * Normalize tag text into the canonical key stored in photo metadata.
 */
function normalizeTagText(value) {
  return String(value ?? "").trim();
}

async function prepareLibraryWrite(reason, { immediate = false } = {}) {
  const library = activeLibrary;
  if (!library || !["opening", "open"].includes(library.state)) throw new Error("No writable library session is active");
  if (maintenanceState.running) throw new Error("The library is read-only while maintenance is running");
  await createLibraryBackup(library.paths, {
    kind: immediate ? "immediate" : "daily",
    reason,
    retentionCount: config.backup.retentionCount,
  });
}

async function touchLibraryManifest() {
  if (!activeLibrary) return;
  const nextManifest = { ...activeLibrary.manifest, updatedAt: new Date().toISOString() };
  try {
    activeLibrary.manifest = await writeLibraryManifest(activeLibrary.paths, nextManifest);
  } catch (error) {
    // The JSONL commit is already durable at this point. updatedAt is advisory,
    // so a manifest timestamp failure must not make memory diverge from disk.
    appendLog(`library manifest timestamp update failed: ${error.message}`);
  }
}

/**
 * Return tag definitions sorted by tag text, including current usage counts.
 */
function listTagDefinitions() {
  const usage = getTagUsageCounts();
  return [...tagRegistryIndex.values()]
    .map((tag) => ({
      ...tag,
      UsageCount: usage.get(tag.Text) || 0,
    }))
    .sort((a, b) => a.Text.localeCompare(b.Text, "zh-CN"));
}

/**
 * Count how many metadata records currently use each registered tag text.
 */
function getTagUsageCounts() {
  const counts = new Map();
  for (const item of metadataIndex.values()) {
    const tags = Array.isArray(item?.Customization?.Tags) ? item.Customization.Tags : [];
    for (const rawTag of tags) {
      const tag = normalizeTagText(rawTag);
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Persist tag registry JSONL using the same temp-file replacement style as metadata.
 */
async function saveTagRegistryMap(options = {}) {
  if (options.backup !== false) await prepareLibraryWrite("tag-registry-write");
  const registryFile = resolveDataFile(DATA_FILE_NAMES.tags);
  await writeJsonlAtomic(registryFile, [...tagRegistryIndex.values()].sort((a, b) => a.Text.localeCompare(b.Text, "zh-CN")));
  await touchLibraryManifest();
}

/**
 * Add missing registry definitions for tags already present in photo metadata.
 */
function seedRegistryFromMetadata() {
  const now = new Date().toISOString();
  let added = 0;

  for (const item of metadataIndex.values()) {
    const tags = Array.isArray(item?.Customization?.Tags) ? item.Customization.Tags : [];
    for (const rawTag of tags) {
      const tagText = normalizeTagText(rawTag);
      if (!tagText || tagRegistryIndex.has(tagText)) continue;
      tagRegistryIndex.set(tagText, {
        Text: tagText,
        Description: DEFAULT_TAG_DESCRIPTION,
        CreatedAt: now,
        UpdatedAt: now,
      });
      added += 1;
    }
  }

  return added;
}

/**
 * Read the tag registry JSONL into memory, then backfill definitions for legacy tags.
 */
async function loadTagRegistryIndex() {
  tagRegistryIndex.clear();
  const registryFile = resolveDataFile(DATA_FILE_NAMES.tags);
  const fileExists = fs.existsSync(registryFile);

  if (fileExists) {
    const entries = await readJsonlStrict(registryFile, { label: DATA_FILE_NAMES.tags, keyOf: (item) => item?.Text });
    for (const parsed of entries) {
      const text = normalizeTagText(parsed.Text);
      if (!text || tagRegistryIndex.has(text)) throw new Error(`Invalid or duplicate tag key: ${text || "<empty>"}`);
      const createdAt = typeof parsed?.CreatedAt === "string" ? parsed.CreatedAt : new Date().toISOString();
      const updatedAt = typeof parsed?.UpdatedAt === "string" ? parsed.UpdatedAt : createdAt;
      tagRegistryIndex.set(text, {
        Text: text,
        Description: normalizeTagText(parsed?.Description),
        CreatedAt: createdAt,
        UpdatedAt: updatedAt,
      });
    }
  }

  const added = seedRegistryFromMetadata();
  if (!fileExists || added > 0) {
    await saveTagRegistryMap();
  }
}

/**
 * Normalize and validate tag arrays before writing photo metadata.
 */
function normalizeRegisteredTags(rawTags) {
  const tags = Array.isArray(rawTags) ? rawTags : [];
  const normalized = [...new Set(tags.map(normalizeTagText).filter(Boolean))];
  const unknown = normalized.filter((tag) => !tagRegistryIndex.has(tag));
  return { tags: normalized, unknown };
}

/**
 * Normalize person name into the canonical key stored in photo metadata.
 */
function normalizePersonName(value) {
  return String(value ?? "").trim();
}

/**
 * Count how many metadata records currently reference each registered person.
 */
function getPersonUsageCounts() {
  const counts = new Map();
  for (const item of metadataIndex.values()) {
    const people = Array.isArray(item?.Customization?.People) ? item.Customization.People : [];
    for (const rawPerson of people) {
      const person = normalizePersonName(rawPerson);
      if (!person) continue;
      counts.set(person, (counts.get(person) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Return person definitions sorted by name, including current usage counts.
 */
function listPersonDefinitions() {
  const usage = getPersonUsageCounts();
  return [...personRegistryIndex.values()]
    .map((person) => ({
      ...person,
      UsageCount: usage.get(person.Name) || 0,
    }))
    .sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN"));
}

/**
 * Persist person registry JSONL using temp-file replacement.
 */
async function savePersonRegistryMap(options = {}) {
  if (options.backup !== false) await prepareLibraryWrite("person-registry-write");
  const registryFile = resolveDataFile(DATA_FILE_NAMES.people);
  await writeJsonlAtomic(registryFile, [...personRegistryIndex.values()].sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN")));
  await touchLibraryManifest();
}

/**
 * Add missing registry definitions for people already present in photo metadata.
 */
function seedPersonRegistryFromMetadata() {
  const now = new Date().toISOString();
  let added = 0;

  for (const item of metadataIndex.values()) {
    const people = Array.isArray(item?.Customization?.People) ? item.Customization.People : [];
    for (const rawPerson of people) {
      const name = normalizePersonName(rawPerson);
      if (!name || personRegistryIndex.has(name)) continue;
      personRegistryIndex.set(name, {
        Name: name,
        Description: "",
        CreatedAt: now,
        UpdatedAt: now,
      });
      added += 1;
    }
  }

  return added;
}

/**
 * Read the person registry JSONL into memory, then backfill legacy people.
 */
async function loadPersonRegistryIndex() {
  personRegistryIndex.clear();
  const registryFile = resolveDataFile(DATA_FILE_NAMES.people);
  const fileExists = fs.existsSync(registryFile);

  if (fileExists) {
    const entries = await readJsonlStrict(registryFile, { label: DATA_FILE_NAMES.people, keyOf: (item) => item?.Name });
    for (const parsed of entries) {
      const name = normalizePersonName(parsed.Name);
      if (!name || personRegistryIndex.has(name)) throw new Error(`Invalid or duplicate person key: ${name || "<empty>"}`);
      const createdAt = typeof parsed?.CreatedAt === "string" ? parsed.CreatedAt : new Date().toISOString();
      const updatedAt = typeof parsed?.UpdatedAt === "string" ? parsed.UpdatedAt : createdAt;
      personRegistryIndex.set(name, {
        Name: name,
        Description: normalizePersonName(parsed?.Description),
        CreatedAt: createdAt,
        UpdatedAt: updatedAt,
      });
    }
  }

  const added = seedPersonRegistryFromMetadata();
  if (!fileExists || added > 0) {
    await savePersonRegistryMap();
  }
}

/**
 * Normalize and validate person arrays before writing photo metadata.
 */
function normalizeRegisteredPeople(rawPeople) {
  const people = Array.isArray(rawPeople) ? rawPeople : [];
  const normalized = [...new Set(people.map(normalizePersonName).filter(Boolean))];
  const unknown = normalized.filter((person) => !personRegistryIndex.has(person));
  return { people: normalized, unknown };
}
/**
 * Normalize location text fields into canonical registry strings.
 */
function normalizeLocationName(value) {
  return String(value ?? "").trim();
}

function normalizeLocationField(value) {
  return String(value ?? "").trim();
}

function normalizeLocationObject(rawLocation) {
  const source = rawLocation && typeof rawLocation === "object" ? rawLocation : {};
  return {
    Place: normalizeLocationName(source.Place ?? source.Site),
    Detail: normalizeLocationField(source.Detail),
  };
}

function getLocationUsageCounts() {
  const counts = new Map();
  for (const item of metadataIndex.values()) {
    const place = normalizeLocationName(item?.Location?.Place ?? item?.Location?.Site);
    if (!place) continue;
    counts.set(place, (counts.get(place) || 0) + 1);
  }
  return counts;
}

function getLocationChildrenMap() {
  const children = new Map();
  for (const location of locationRegistryIndex.values()) {
    if (!children.has(location.Name)) children.set(location.Name, []);
  }
  for (const location of locationRegistryIndex.values()) {
    const parent = normalizeLocationName(location.Parent);
    if (!parent || !locationRegistryIndex.has(parent)) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(location.Name);
  }
  for (const names of children.values()) {
    names.sort((a, b) => a.localeCompare(b, "zh-CN"));
  }
  return children;
}

function getLocationDescendants(name) {
  const root = normalizeLocationName(name);
  const children = getLocationChildrenMap();
  const output = [];
  const stack = [...(children.get(root) || [])];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    output.push(current);
    stack.push(...(children.get(current) || []));
  }
  return output;
}

function buildLocationPath(name) {
  const parts = [];
  const seen = new Set();
  let current = normalizeLocationName(name);
  while (current && locationRegistryIndex.has(current) && !seen.has(current)) {
    seen.add(current);
    parts.unshift(current);
    current = normalizeLocationName(locationRegistryIndex.get(current)?.Parent);
  }
  return parts;
}

function getLocationDepth(name) {
  return Math.max(0, buildLocationPath(name).length - 1);
}

function validateLocationParent(name, parent) {
  const normalizedName = normalizeLocationName(name);
  const normalizedParent = normalizeLocationName(parent);
  if (!normalizedParent) return { ok: true, parent: "" };
  if (!locationRegistryIndex.has(normalizedParent)) {
    return { ok: false, error: "Parent location not found" };
  }
  if (normalizedParent === normalizedName) {
    return { ok: false, error: "Location cannot be its own parent" };
  }
  if (normalizedName && getLocationDescendants(normalizedName).includes(normalizedParent)) {
    return { ok: false, error: "Parent cannot be a descendant location" };
  }
  return { ok: true, parent: normalizedParent };
}

function listLocationDefinitions() {
  const usage = getLocationUsageCounts();
  const children = getLocationChildrenMap();
  return [...locationRegistryIndex.values()]
    .map((location) => ({
      ...location,
      UsageCount: usage.get(location.Name) || 0,
      Children: children.get(location.Name) || [],
      Depth: getLocationDepth(location.Name),
      Path: buildLocationPath(location.Name),
    }))
    .sort((a, b) => a.Path.join("/").localeCompare(b.Path.join("/"), "zh-CN"));
}

async function saveLocationRegistryMap(options = {}) {
  if (options.backup !== false) await prepareLibraryWrite("location-registry-write");
  const registryFile = resolveDataFile(DATA_FILE_NAMES.locations);
  await writeJsonlAtomic(registryFile, [...locationRegistryIndex.values()].sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN")));
  await touchLibraryManifest();
}

function upsertLocationFromMetadata(name, sourceLocation, now) {
  const locationName = normalizeLocationName(name);
  if (!locationName || locationRegistryIndex.has(locationName)) return false;
  locationRegistryIndex.set(locationName, {
    Name: locationName,
    Country: normalizeLocationField(sourceLocation?.Country),
    Province: normalizeLocationField(sourceLocation?.Province),
    City: normalizeLocationField(sourceLocation?.City),
    Parent: "",
    Description: "",
    CreatedAt: now,
    UpdatedAt: now,
  });
  return true;
}

function normalizeAllMetadataLocations() {
  const now = new Date().toISOString();
  let registryAdded = 0;
  let metadataChanged = 0;

  for (const [filePath, item] of metadataIndex.entries()) {
    const original = item?.Location && typeof item.Location === "object" ? item.Location : {};
    const place = normalizeLocationName(original.Place ?? original.Site);
    const detail = normalizeLocationField(original.Detail);

    if (place && upsertLocationFromMetadata(place, original, now)) {
      registryAdded += 1;
    }

    const nextLocation = { Place: place, Detail: detail };
    if (original.Place !== nextLocation.Place || original.Detail !== nextLocation.Detail || Object.keys(original).some((key) => !["Place", "Detail"].includes(key))) {
      item.Location = nextLocation;
      item.Customization = {
        ...(item.Customization || {}),
        MetadataUpdateDate: item?.Customization?.MetadataUpdateDate || now,
      };
      metadataIndex.set(filePath, item);
      metadataChanged += 1;
    }
  }

  return { registryAdded, metadataChanged };
}

function sanitizeLocationParentLinks() {
  let changed = 0;
  for (const [name, location] of locationRegistryIndex.entries()) {
    const parent = normalizeLocationName(location.Parent);
    if (!parent) {
      if (location.Parent !== "") {
        locationRegistryIndex.set(name, { ...location, Parent: "", UpdatedAt: new Date().toISOString() });
        changed += 1;
      }
      continue;
    }
    const validation = validateLocationParent(name, parent);
    if (!validation.ok) {
      locationRegistryIndex.set(name, { ...location, Parent: "", UpdatedAt: new Date().toISOString() });
      changed += 1;
    }
  }
  return changed;
}

async function loadLocationRegistryIndex() {
  locationRegistryIndex.clear();
  const registryFile = resolveDataFile(DATA_FILE_NAMES.locations);
  const fileExists = fs.existsSync(registryFile);

  if (fileExists) {
    const entries = await readJsonlStrict(registryFile, { label: DATA_FILE_NAMES.locations, keyOf: (item) => item?.Name });
    for (const parsed of entries) {
      const name = normalizeLocationName(parsed.Name);
      if (!name || locationRegistryIndex.has(name)) throw new Error(`Invalid or duplicate location key: ${name || "<empty>"}`);
      const createdAt = typeof parsed?.CreatedAt === "string" ? parsed.CreatedAt : new Date().toISOString();
      const updatedAt = typeof parsed?.UpdatedAt === "string" ? parsed.UpdatedAt : createdAt;
      locationRegistryIndex.set(name, {
        Name: name,
        Country: normalizeLocationField(parsed?.Country),
        Province: normalizeLocationField(parsed?.Province),
        City: normalizeLocationField(parsed?.City),
        Parent: normalizeLocationName(parsed?.Parent),
        Description: normalizeLocationField(parsed?.Description),
        CreatedAt: createdAt,
        UpdatedAt: updatedAt,
      });
    }
  }

  const normalized = normalizeAllMetadataLocations();
  const parentFixes = sanitizeLocationParentLinks();
  const registryChanged = !fileExists || normalized.registryAdded > 0 || parentFixes > 0;
  if (registryChanged && normalized.metadataChanged > 0) {
    await prepareLibraryWrite("location-registry-migration");
    await saveRegistryAndMetadataTransaction(
      DATA_FILE_NAMES.locations,
      [...locationRegistryIndex.values()].sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN")),
      "location-registry-migration",
      true,
    );
  } else if (registryChanged) {
    await saveLocationRegistryMap();
  } else if (normalized.metadataChanged > 0) {
    await saveMetadataMap();
  }
}

function normalizeRegisteredLocation(rawLocation) {
  const location = normalizeLocationObject(rawLocation);
  const unknown = location.Place && !locationRegistryIndex.has(location.Place) ? [location.Place] : [];
  return { location, unknown };
}
/**
 * Normalize album title into the canonical string stored on photo metadata.
 */
function normalizeAlbumTitle(value) {
  return String(value ?? "").trim();
}

/**
 * Count how many metadata records currently use each registered album title.
 */
function getAlbumUsageCounts() {
  const counts = new Map();
  for (const item of metadataIndex.values()) {
    const album = normalizeAlbumTitle(item?.Customization?.Album);
    if (!album) continue;
    counts.set(album, (counts.get(album) || 0) + 1);
  }
  return counts;
}

/**
 * Return album definitions sorted by title, including current usage counts.
 */
function listAlbumDefinitions() {
  const usage = getAlbumUsageCounts();
  return [...albumRegistryIndex.values()]
    .map((album) => ({
      ...album,
      UsageCount: usage.get(album.Title) || 0,
    }))
    .sort((a, b) => a.Title.localeCompare(b.Title, "zh-CN"));
}

/**
 * Persist album registry JSONL using temp-file replacement.
 */
async function saveAlbumRegistryMap(options = {}) {
  if (options.backup !== false) await prepareLibraryWrite("album-registry-write");
  const registryFile = resolveDataFile(DATA_FILE_NAMES.albums);
  await writeJsonlAtomic(registryFile, [...albumRegistryIndex.values()].sort((a, b) => a.Title.localeCompare(b.Title, "zh-CN")));
  await touchLibraryManifest();
}

/**
 * Add missing registry definitions for albums already present in photo metadata.
 */
function seedAlbumRegistryFromMetadata() {
  const now = new Date().toISOString();
  let added = 0;

  for (const item of metadataIndex.values()) {
    const title = normalizeAlbumTitle(item?.Customization?.Album);
    if (!title || albumRegistryIndex.has(title)) continue;
    albumRegistryIndex.set(title, {
      Title: title,
      Description: DEFAULT_ALBUM_DESCRIPTION,
      CreatedAt: now,
      UpdatedAt: now,
    });
    added += 1;
  }

  return added;
}

/**
 * Read the album registry JSONL into memory, then backfill legacy albums.
 */
async function loadAlbumRegistryIndex() {
  albumRegistryIndex.clear();
  const registryFile = resolveDataFile(DATA_FILE_NAMES.albums);
  const fileExists = fs.existsSync(registryFile);

  if (fileExists) {
    const entries = await readJsonlStrict(registryFile, { label: DATA_FILE_NAMES.albums, keyOf: (item) => item?.Title });
    for (const parsed of entries) {
      const title = normalizeAlbumTitle(parsed.Title);
      if (!title || albumRegistryIndex.has(title)) throw new Error(`Invalid or duplicate album key: ${title || "<empty>"}`);
      const createdAt = typeof parsed?.CreatedAt === "string" ? parsed.CreatedAt : new Date().toISOString();
      const updatedAt = typeof parsed?.UpdatedAt === "string" ? parsed.UpdatedAt : createdAt;
      albumRegistryIndex.set(title, {
        Title: title,
        Description: normalizeAlbumTitle(parsed?.Description) || DEFAULT_ALBUM_DESCRIPTION,
        CreatedAt: createdAt,
        UpdatedAt: updatedAt,
      });
    }
  }

  const added = seedAlbumRegistryFromMetadata();
  if (!fileExists || added > 0) {
    await saveAlbumRegistryMap();
  }
}

/**
 * Normalize and validate a photo album value before writing metadata.
 */
function normalizeRegisteredAlbum(rawAlbum) {
  const album = normalizeAlbumTitle(rawAlbum);
  const unknown = album && !albumRegistryIndex.has(album) ? [album] : [];
  return { album, unknown };
}

/**
 * Apply gallery-level filtering/searching/sorting in memory.
 * Filter semantics match the requirement document:
 * - hidden items are excluded
 * - Album/Tag filters are intersected
 * - search is exact substring matching
 */
function filterAndSort(list, options) {
  const { filters, search, sortBy, sortOrder } = options;

  let output = list.filter((item) => !item?.Customization?.Hidden);

  if (filters.mediaType === "image" || filters.mediaType === "video") {
    output = output.filter((item) => item?.FileSystem?.FileType === filters.mediaType);
  }

  if (filters.album === UNASSIGNED_ALBUM_FILTER) {
    output = output.filter((item) => !normalizeAlbumTitle(item?.Customization?.Album));
  } else if (filters.album) {
    output = output.filter((item) => item?.Customization?.Album === filters.album);
  }

  if (filters.tag) {
    output = output.filter((item) => Array.isArray(item?.Customization?.Tags) && item.Customization.Tags.includes(filters.tag));
  }

  if (filters.person) {
    output = output.filter((item) => Array.isArray(item?.Customization?.People) && item.Customization.People.includes(filters.person));
  }

  if (filters.location) {
    const allowedLocations = new Set([normalizeLocationName(filters.location), ...getLocationDescendants(filters.location)]);
    output = output.filter((item) => allowedLocations.has(normalizeLocationName(item?.Location?.Place ?? item?.Location?.Site)));
  }

  if (search?.value && search?.field) {
    output = output.filter((item) => {
      const keyword = search.value;
      const fieldValue = (() => {
        if (search.field === "title") return item?.Customization?.Title || "";
        if (search.field === "filename") return path.basename(item?.FilePath || "");
        if (search.field === "description") return item?.Customization?.Description || "";
        return "";
      })();
      return fieldValue.includes(keyword);
    });
  }

  output.sort((a, b) => {
    let va;
    let vb;

    if (sortBy === "filename") {
      va = path.basename(a.FilePath || "");
      vb = path.basename(b.FilePath || "");
    } else if (sortBy === "rating") {
      va = a?.Customization?.Rating || 0;
      vb = b?.Customization?.Rating || 0;
    } else {
      va = a?.FileSystem?.ShootingTimeString || "";
      vb = b?.FileSystem?.ShootingTimeString || "";
    }

    if (va < vb) return sortOrder === "asc" ? -1 : 1;
    if (va > vb) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  return output;
}

/**
 * Inject renderer-facing helper fields:
 * - absolute file path for image loading/copy
 * - date grouping key for gallery sections
 */
function enrichItem(item) {
  const library = requireOpenLibrary();
  const absPath = assertPathInsideLibrary(library.paths, path.join(library.paths.root, item.FilePath));
  const thumbPath = item?.SHA256Hash ? thumbnailAbsolutePath(library.paths.thumbnailDir, item.SHA256Hash) : "";
  return {
    ...item,
    __absolutePath: absPath,
    __thumbnailPath: thumbPath,
    __thumbnailAvailable: Boolean(thumbPath && fs.existsSync(thumbPath)),
    __groupDate: (item?.FileSystem?.ShootingTimeString || "").slice(0, 10) || "Unknown",
  };
}

function resolveIndexedMediaPath(rawFilePath) {
  const filePath = String(rawFilePath || "").replace(/\\/g, "/");
  const item = metadataIndex.get(filePath);
  if (!item) throw new Error("Media record not found");
  const library = requireOpenLibrary();
  const absolutePath = assertPathInsideLibrary(library.paths, path.join(library.paths.root, item.FilePath));
  if (!fs.existsSync(absolutePath)) throw new Error("Media file not found");
  return { item, absolutePath };
}

/**
 * Warm thumbnail cache in the background.
 * Gallery rendering can still fall back to original image paths while cache fills.
 */
async function warmupThumbnailCache() {
  if (thumbnailWarmupStarted || maintenanceState.running || !activeLibrary) return;
  thumbnailWarmupStarted = true;
  const sessionId = activeLibrary.sessionId;
  const token = { sessionId, cancelled: false };
  thumbnailWarmupToken = token;
  const thumbnailConfig = normalizeThumbnailConfig(config.thumbnail);
  const workspaceRoot = activeLibrary.paths.root;
  const thumbnailDir = activeLibrary.paths.thumbnailDir;
  const mediaItems = [...metadataIndex.values()].filter((item) => ["image", "video"].includes(item?.FileSystem?.FileType));
  if (!mediaItems.length) {
    thumbnailWarmupToken = null;
    thumbnailWarmupStarted = false;
    return;
  }

  const expectedManifest = buildThumbnailManifest(thumbnailConfig);
  let storedManifest = null;
  try { storedManifest = JSON.parse(await fsp.readFile(activeLibrary.paths.thumbnailManifestFile, "utf8")); } catch { storedManifest = null; }
  const force = !thumbnailManifestMatches(storedManifest, expectedManifest);

  try {
    const stats = await ensureThumbnailsForItems(mediaItems, {
      workspaceRoot,
      cacheDir: thumbnailDir,
      options: thumbnailConfig,
      maxConcurrency: thumbnailConfig.maxConcurrency,
      mediaConfig: config.media,
      force,
      logger: (message) => appendLog(message),
      onGenerated: (item, thumbnailPath) => {
        if (token.cancelled || !activeLibrary || activeLibrary.sessionId !== sessionId || !mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send("thumbnail:ready", {
          filePath: item.FilePath,
          hash: item.SHA256Hash,
          thumbnailPath,
          thumbnailAvailable: true,
        });
      },
      isCancelled: () => token.cancelled || activeLibrary?.sessionId !== sessionId,
    });
    appendLog(
      `thumbnail-warmup total=${stats.total} generated=${stats.generated} skipped=${stats.skipped} failed=${stats.failed}`,
    );
    if (stats.failed === 0 && activeLibrary?.sessionId === sessionId) {
      await writeTextAtomic(activeLibrary.paths.thumbnailManifestFile, `${JSON.stringify(expectedManifest, null, 2)}\n`);
    }
  } finally {
    if (thumbnailWarmupToken === token) {
      thumbnailWarmupToken = null;
      thumbnailWarmupStarted = false;
    }
  }
}

/**
 * Persist full metadata Map back to JSONL using atomic replace:
 * write temp file -> rename.
 */
async function saveMetadataMap(options = {}) {
  if (options.backup !== false) await prepareLibraryWrite(options.reason || "metadata-write", { immediate: Boolean(options.immediate) });
  const metadataFile = resolveDataFile(DATA_FILE_NAMES.metadata);
  await writeJsonlAtomic(metadataFile, metadataIndex.values());
  await touchLibraryManifest();
}

async function saveRegistryAndMetadataTransaction(registryFileName, registryEntries, reason, includeMetadata) {
  const library = activeLibrary;
  if (!library || !["opening", "open"].includes(library.state)) throw new Error("No writable library session is active");
  if (maintenanceState.running) throw new Error("The library is read-only while maintenance is running");
  const changes = [{
    filePath: resolveDataFile(registryFileName),
    entries: registryEntries,
  }];
  if (includeMetadata) {
    changes.push({
      filePath: resolveDataFile(DATA_FILE_NAMES.metadata),
      entries: metadataIndex.values(),
    });
  }
  await commitJsonlTransaction(library.paths, changes, { reason });
  await touchLibraryManifest();
}

function clearLibraryIndexes() {
  metadataIndex.clear();
  tagRegistryIndex.clear();
  albumRegistryIndex.clear();
  personRegistryIndex.clear();
  locationRegistryIndex.clear();
}

function emitLibraryState(extra = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("library:state-changed", toSerializable(getLibraryState(extra)));
}

function getLibraryState(extra = {}) {
  return {
    state: activeLibrary?.state || "closed",
    active: activeLibrary ? {
      root: activeLibrary.paths.root,
      name: activeLibrary.manifest.name,
      libraryId: activeLibrary.manifest.libraryId,
      createdAt: activeLibrary.manifest.createdAt,
      updatedAt: activeLibrary.manifest.updatedAt,
      mediaCount: metadataIndex.size,
      imageCount: [...metadataIndex.values()].filter((item) => item?.FileSystem?.FileType === "image").length,
      videoCount: [...metadataIndex.values()].filter((item) => item?.FileSystem?.FileType === "video").length,
    } : null,
    lastLibraryPath: appState.lastLibraryPath,
    mediaTools: mediaToolsState,
    maintenance: maintenanceState,
    ...extra,
  };
}

async function checkMediaTools() {
  try {
    const tools = await validateMediaTools(APP_ROOT, config.media);
    mediaToolsState = { available: true, error: "", versions: tools.versions };
    appendLog(`media-tools ${tools.versions.ffmpeg}; ${tools.versions.ffprobe}`);
  } catch (error) {
    const reason = sanitizeMediaError(error, error?.path || "");
    mediaToolsState = { available: false, error: reason, versions: null };
    appendLog(`media-tools validation failed: ${reason}`);
  }
  emitLibraryState();
  return mediaToolsState;
}

async function loadAllLibraryIndexes() {
  await loadMetadataIndex();
  await loadTagRegistryIndex();
  await loadAlbumRegistryIndex();
  await loadPersonRegistryIndex();
  await loadLocationRegistryIndex();
  const hashes = new Map();
  for (const item of metadataIndex.values()) {
    if (!item.SHA256Hash) continue;
    if (!hashes.has(item.SHA256Hash)) hashes.set(item.SHA256Hash, []);
    hashes.get(item.SHA256Hash).push(item.FilePath);
  }
  for (const [hash, filePaths] of hashes) {
    if (filePaths.length > 1) appendLog(`duplicate-sha256 hash=${hash} files=${filePaths.sort().join("|")}`);
  }
}

async function openLibrary(rawRoot, options = {}) {
  if (!mediaToolsState.available) {
    const error = new Error(`FFmpeg 媒体工具不可用：${mediaToolsState.error}`);
    error.code = "MEDIA_TOOLS_UNAVAILABLE";
    throw error;
  }
  if (maintenanceState.running) {
    const error = new Error("A maintenance operation is running");
    error.code = "MAINTENANCE_RUNNING";
    throw error;
  }
  if (activeWorker) {
    const error = new Error("A library operation is already running");
    error.code = "MAINTENANCE_RUNNING";
    throw error;
  }
  if (activeLibrary) await closeLibrary({ preserveLastPath: true });
  const paths = resolveLibraryPaths(rawRoot);
  emitLibraryState({ state: "opening", openingPath: paths.root });
  let lock = null;
  try {
    const marker = fs.existsSync(paths.initializationFile)
      ? JSON.parse(await fsp.readFile(paths.initializationFile, "utf8"))
      : null;
    if (marker && marker.Status !== "committed") {
      const error = new Error(marker.Error || "The previous library initialization did not complete");
      error.code = "LIBRARY_INITIALIZATION_FAILED";
      error.initialization = marker;
      throw error;
    }
    const manifest = await validateExistingLibrary(paths, {
      onProgress: (progress) => mainWindow?.webContents.send("library:progress", toSerializable(progress)),
    });
    lock = await acquireLibraryLock(paths, manifest, {
      force: Boolean(options.force),
      applicationStartedAt,
    });
    activeLibrary = { state: "opening", sessionId: lock.SessionId, paths, manifest, lock };
    const recovery = await recoverPendingTransaction(paths);
    if (recovery.recovered) appendLog(`library-transaction ${recovery.action} reason=${recovery.reason || "unknown"}`);
    await loadAllLibraryIndexes();
    if (marker?.Status === "committed") await fsp.rm(paths.initializationFile, { force: true });
    activeLibrary.state = "open";
    thumbnailWarmupStarted = false;
    appState.lastLibraryPath = paths.root;
    await saveAppState().catch((error) => appendLog(`app-state write failed: ${error.message}`));
    emitLibraryState();
    return getLibraryState();
  } catch (error) {
    if (lock) await releaseLibraryLock(paths, lock.SessionId).catch(() => {});
    activeLibrary = null;
    clearLibraryIndexes();
    emitLibraryState({ error: error.message });
    throw error;
  }
}

async function closeLibrary(options = {}) {
  if (maintenanceState.running) {
    const error = new Error("Cannot close the library while maintenance is running");
    error.code = "MAINTENANCE_RUNNING";
    throw error;
  }
  if (!activeLibrary) return getLibraryState();
  activeLibrary.state = "closing";
  emitLibraryState();
  const closing = activeLibrary;
  if (thumbnailWarmupToken?.sessionId === closing.sessionId) thumbnailWarmupToken.cancelled = true;
  thumbnailWarmupToken = null;
  activeLibrary = null;
  thumbnailWarmupStarted = false;
  clearLibraryIndexes();
  await releaseLibraryLock(closing.paths, closing.sessionId).catch((error) => appendLog(`lock-release failed: ${error.message}`));
  if (!options.preserveLastPath) {
    // Returning to the entry screen intentionally keeps lastLibraryPath for the next launch.
  }
  emitLibraryState();
  return getLibraryState();
}

async function inspectLibraryDirectory(rawRoot) {
  if (!mediaToolsState.available) {
    const error = new Error(`FFmpeg 媒体工具不可用：${mediaToolsState.error}`);
    error.code = "MEDIA_TOOLS_UNAVAILABLE";
    throw error;
  }
  const paths = resolveLibraryPaths(rawRoot);
  const stat = await fsp.stat(paths.root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error("The selected library directory does not exist");
  const linkStat = await fsp.lstat(paths.root);
  if (linkStat.isSymbolicLink()) throw new Error("不能把符号链接目录用作图库根目录");
  const parentManager = findParentManagerDirectory(paths.root);
  if (parentManager) throw new Error(`所选目录位于另一个图库内部：${parentManager}`);
  if (fs.existsSync(paths.managerDir)) {
    if (fs.existsSync(paths.initializationFile)) {
      const marker = JSON.parse(await fsp.readFile(paths.initializationFile, "utf8"));
      if (marker?.Status !== "committed") {
        const lockState = await inspectLibraryLock(paths);
        if (lockState.active) {
          const error = new Error("该目录正在由另一个进程初始化，不能打开或清理");
          error.code = "LIBRARY_LOCKED";
          throw error;
        }
        return {
          kind: "failed-initialization",
          root: paths.root,
          marker: {
            ...marker,
            Error: marker?.Error || "上一次图库初始化在完成前中断。",
          },
        };
      }
    }
    const manifest = await readLibraryManifest(paths);
    return { kind: "existing", root: paths.root, manifest };
  }
  quickScanState = { cancelled: false };
  try {
    const files = await walkFiles(paths.root, {
      isCancelled: () => quickScanState?.cancelled,
      onProgress: ({ visitedDirectories, current }) => mainWindow?.webContents.send("library:progress", {
        phase: "quick-scan",
        processed: visitedDirectories,
        current: path.relative(paths.root, current).replace(/\\/g, "/") || ".",
      }),
    });
    return {
      kind: "uninitialized",
      root: paths.root,
      name: path.basename(paths.root),
      mediaCount: files.filter((file) => extensionType(path.extname(file))).length,
    };
  } finally {
    quickScanState = null;
  }
}

function runOperationWorker(operation, root, options = {}) {
  if (activeWorker) {
    const error = new Error("Another library operation is already running");
    error.code = "MAINTENANCE_RUNNING";
    return Promise.reject(error);
  }
  const workerPath = path.join(APP_ROOT, "scripts", "maintenance-worker.js");
  const worker = fork(workerPath, [operation, root, JSON.stringify(options)], {
    cwd: APP_ROOT,
    windowsHide: true,
    env: {
      ...process.env,
      PHOTO_MANAGER_LIBRARY_SESSION: operation === "initialize" ? "" : activeLibrary?.sessionId || "",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  activeWorker = worker;
  activeWorkerOperation = operation;
  return new Promise((resolve, reject) => {
    let result = null;
    let failure = null;
    worker.stdout?.on("data", (chunk) => appendOperationLog(operation, root, `worker-${operation} ${String(chunk).trim()}`));
    worker.stderr?.on("data", (chunk) => appendOperationLog(operation, root, `worker-${operation}-stderr ${String(chunk).trim()}`));
    worker.on("message", (message) => {
      if (message?.type === "progress" || message?.type === "log") {
        maintenanceState.progress = message;
        if (message.message) appendOperationLog(operation, root, `worker-${operation} ${message.level || "info"}: ${message.message}`);
        mainWindow?.webContents.send(operation === "initialize" ? "library:progress" : "maintenance:progress", toSerializable(message));
      }
      if (message?.type === "result") result = message.result;
      if (message?.type === "failure") failure = message.error;
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      activeWorker = null;
      activeWorkerOperation = "";
      if (pendingAppClose) {
        pendingAppClose = false;
        setImmediate(() => {
          mainWindow?.destroy();
          app.quit();
        });
      }
      if (code === 0 && result) resolve(result);
      else {
        const error = new Error(failure?.message || `${operation} worker exited with code ${code}`);
        error.code = failure?.code || "OPERATION_FAILED";
        reject(error);
      }
    });
  });
}

async function runMaintenanceOperation(operation, options = {}) {
  const library = requireOpenLibrary({ writable: true });
  if (thumbnailWarmupToken?.sessionId === library.sessionId) thumbnailWarmupToken.cancelled = true;
  thumbnailWarmupToken = null;
  maintenanceState = { running: true, operation, progress: null, report: null };
  thumbnailWarmupStarted = false;
  let updateCompleted = false;
  emitLibraryState();
  try {
    const result = await runOperationWorker(operation, library.paths.root, options);
    maintenanceState.report = result;
    if (operation === "update") {
      // The child process has released its operation lock. Clear the read-only
      // flag before reloading because legacy registry backfill may persist data.
      maintenanceState.running = false;
      await loadAllLibraryIndexes();
      updateCompleted = true;
    }
    mainWindow?.webContents.send("maintenance:completed", { ok: true, operation, result });
    return { ok: true, result };
  } catch (error) {
    appendLog(`maintenance-${operation} failed: ${error.stack || error.message}`);
    mainWindow?.webContents.send("maintenance:completed", { ok: false, operation, error: error.message });
    return { ok: false, error: error.message, code: error.code };
  } finally {
    maintenanceState.running = false;
    maintenanceState.operation = "";
    emitLibraryState();
    if (updateCompleted) warmupThumbnailCache().catch((error) => appendLog(`thumbnail-warmup failed: ${error.message}`));
  }
}

/**
 * Register all IPC endpoints used by renderer.
 * Channels are intentionally explicit to keep the API surface narrow and auditable.
 */
function registerIpcHandlers() {
  ipcMain.handle("app:get-config", async () => toSerializable(config));
  ipcMain.handle("app:update-config", async (_, patch) => {
    try {
      const allowedPatch = {};
      for (const key of ["thumbnail", "media", "backup", "ui"]) {
        if (patch?.[key] !== undefined) allowedPatch[key] = patch[key];
      }
      config = deepMerge(config, allowedPatch);
      config.media = normalizeMediaConfig(config.media);
      config.backup.retentionCount = Math.max(1, Math.trunc(Number(config.backup.retentionCount) || 10));
      await saveConfig();
      return { ok: true, config: toSerializable(config) };
    } catch (error) {
      appendLog(`Failed to update config: ${error.message}`);
      return { ok: false, error: "Failed to update config" };
    }
  });

  ipcMain.handle("library:get-state", async () => toSerializable(getLibraryState()));
  ipcMain.handle("library:recheck-media-tools", async () => toSerializable(await checkMediaTools()));
  ipcMain.handle("library:choose-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择图库根目录",
      properties: ["openDirectory"],
    });
    return result.canceled || !result.filePaths[0] ? { ok: false, canceled: true } : { ok: true, path: result.filePaths[0] };
  });
  ipcMain.handle("library:inspect", async (_, rawRoot) => {
    try {
      return { ok: true, inspection: await inspectLibraryDirectory(rawRoot) };
    } catch (error) {
      return { ok: false, error: error.message, code: error.code };
    }
  });
  ipcMain.handle("library:cancel-scan", async () => {
    if (quickScanState) quickScanState.cancelled = true;
    return { ok: true };
  });
  ipcMain.handle("library:open", async (_, payload) => {
    try {
      return { ok: true, library: await openLibrary(payload?.path, { force: Boolean(payload?.force) }) };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        code: error.code,
        lockState: error.lockState ? toSerializable(error.lockState) : null,
        initialization: error.initialization || null,
      };
    }
  });
  ipcMain.handle("library:initialize", async (_, payload) => {
    if (activeLibrary) return { ok: false, error: "Close the active library before initializing another one" };
    try {
      const paths = resolveLibraryPaths(payload?.path);
      const result = await runOperationWorker("initialize", paths.root, { name: payload?.name || path.basename(paths.root) });
      const library = await openLibrary(paths.root);
      return { ok: true, result, library };
    } catch (error) {
      return { ok: false, error: error.message, code: error.code };
    }
  });
  ipcMain.handle("library:cancel-initialization", async () => {
    if (!activeWorker) return { ok: false, error: "No initialization is running" };
    activeWorker.send({ type: "cancel" });
    return { ok: true };
  });
  ipcMain.handle("library:cleanup-failed-initialization", async (_, rawRoot) => {
    try {
      const paths = resolveLibraryPaths(rawRoot);
      const marker = JSON.parse(await fsp.readFile(paths.initializationFile, "utf8"));
      if (!["failed", "initializing"].includes(marker?.Status)) throw new Error("No incomplete initialization marker was found");
      const lockState = await inspectLibraryLock(paths);
      if (lockState.active) throw new Error("The library initialization process is still active");
      await fsp.rm(paths.managerDir, { recursive: true, force: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle("library:close", async () => {
    try {
      return { ok: true, library: await closeLibrary() };
    } catch (error) {
      return { ok: false, error: error.message, code: error.code };
    }
  });
  ipcMain.handle("library:update-info", async (_, payload) => {
    try {
      const library = requireOpenLibrary({ writable: true });
      await prepareLibraryWrite("library-name-update", { immediate: true });
      const nextManifest = {
        ...library.manifest,
        name: normalizeLibraryName(payload?.name),
        updatedAt: new Date().toISOString(),
      };
      library.manifest = await writeLibraryManifest(library.paths, nextManifest);
      emitLibraryState();
      return { ok: true, library: getLibraryState().active };
    } catch (error) {
      return { ok: false, error: error.message, code: error.code };
    }
  });
  ipcMain.handle("library:open-root", async () => {
    try {
      const library = requireOpenLibrary();
      const error = await shell.openPath(library.paths.root);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("library:open-manager-dir", async () => {
    try {
      const library = requireOpenLibrary();
      const error = await shell.openPath(library.paths.managerDir);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("library:open-log-dir", async () => {
    try {
      const library = requireOpenLibrary();
      const error = await shell.openPath(library.paths.logDir);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("maintenance:show-output", async () => {
    try {
      const library = requireOpenLibrary();
      const outputFile = path.join(library.paths.dataDir, "photo_metadata.csv");
      if (!fs.existsSync(outputFile)) return { ok: false, error: "导出的 CSV 文件不存在" };
      shell.showItemInFolder(outputFile);
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("maintenance:get-state", async () => toSerializable(maintenanceState));
  ipcMain.handle("maintenance:start", async (_, payload) => {
    const operation = String(payload?.operation || "");
    if (!["update", "verify", "thumbnails", "export"].includes(operation)) return { ok: false, error: "Unknown maintenance operation" };
    if (operation === "export" && fs.existsSync(activeLibrary?.paths ? path.join(activeLibrary.paths.dataDir, "photo_metadata.csv") : "") && !payload?.overwrite) {
      return { ok: false, code: "OUTPUT_EXISTS", error: "photo_metadata.csv already exists" };
    }
    return runMaintenanceOperation(operation, {
      reprobe: Boolean(payload?.reprobe),
      force: Boolean(payload?.force),
    });
  });

  ipcMain.handle("gallery:query", async (_, query) => {
    requireOpenLibrary();
    const all = [...metadataIndex.values()].map(enrichItem);
    const filtered = filterAndSort(all, query);
    const mediaCountBase = filterAndSort(all, {
      ...query,
      filters: { ...(query.filters || {}), mediaType: "" },
    });

    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.max(1, Number(query.pageSize || config.ui.gallery.pageSize));
    const start = (page - 1) * pageSize;
    const pageItems = filtered.slice(start, start + pageSize);

    const grouped = new Map();
    for (const item of pageItems) {
      if (!grouped.has(item.__groupDate)) {
        grouped.set(item.__groupDate, []);
      }
      grouped.get(item.__groupDate).push(item);
    }

    // Pagination happens after filter/sort to keep UI behavior consistent.
    const unassignedAlbumCount = all.filter((item) => !normalizeAlbumTitle(item?.Customization?.Album)).length;
    const payload = {
      total: filtered.length,
      mediaCounts: {
        all: mediaCountBase.length,
        images: mediaCountBase.filter((item) => item?.FileSystem?.FileType === "image").length,
        videos: mediaCountBase.filter((item) => item?.FileSystem?.FileType === "video").length,
      },
      page,
      pageSize,
      hasMore: start + pageSize < filtered.length,
      groups: [...grouped.entries()].map(([date, items]) => ({ date, items })),
      filterOptions: {
        albums: [...albumRegistryIndex.keys()].sort((a, b) => a.localeCompare(b, "zh-CN")),
        unassignedAlbumCount,
        tags: [...tagRegistryIndex.keys()].sort((a, b) => a.localeCompare(b, "zh-CN")),
        people: [...personRegistryIndex.keys()].sort((a, b) => a.localeCompare(b, "zh-CN")),
        locations: listLocationDefinitions(),
      },
    };
    return toSerializable(payload);
  });

  ipcMain.handle("tag:list", async () => { requireOpenLibrary(); return toSerializable({ ok: true, tags: listTagDefinitions() }); });

  ipcMain.handle("tag:create", async (_, payload) => {
    requireOpenLibrary({ writable: true });
    const text = normalizeTagText(payload?.text ?? payload?.Text);
    const description = normalizeTagText(payload?.description ?? payload?.Description);
    if (!text) {
      return { ok: false, error: "Tag text is required" };
    }
    if (tagRegistryIndex.has(text)) {
      return { ok: false, error: "Tag already exists" };
    }

    const now = new Date().toISOString();
    const tag = { Text: text, Description: description, CreatedAt: now, UpdatedAt: now };
    tagRegistryIndex.set(text, tag);
    try {
      await saveTagRegistryMap();
      return toSerializable({ ok: true, tag: { ...tag, UsageCount: 0 }, tags: listTagDefinitions() });
    } catch (error) {
      tagRegistryIndex.delete(text);
      appendLog(`Failed to create tag: ${error.message}`);
      return { ok: false, error: "Failed to write tag registry" };
    }
  });

  ipcMain.handle("tag:update-description", async (_, payload) => {
    requireOpenLibrary({ writable: true });
    const text = normalizeTagText(payload?.text ?? payload?.Text);
    const description = normalizeTagText(payload?.description ?? payload?.Description);
    const current = tagRegistryIndex.get(text);
    if (!text) {
      return { ok: false, error: "Tag text is required" };
    }
    if (!current) {
      return { ok: false, error: "Tag not found" };
    }

    const previous = { ...current };
    const next = { ...current, Description: description, UpdatedAt: new Date().toISOString() };
    tagRegistryIndex.set(text, next);
    try {
      await saveTagRegistryMap();
      return toSerializable({ ok: true, tag: { ...next, UsageCount: getTagUsageCounts().get(text) || 0 }, tags: listTagDefinitions() });
    } catch (error) {
      tagRegistryIndex.set(text, previous);
      appendLog(`Failed to update tag description: ${error.message}`);
      return { ok: false, error: "Failed to write tag registry" };
    }
  });

  ipcMain.handle("tag:delete-global", async (_, payload) => {
    requireOpenLibrary({ writable: true });
    const text = normalizeTagText(payload?.text ?? payload?.Text);
    const current = tagRegistryIndex.get(text);
    if (!text || !current) {
      return { ok: false, error: "Tag not found" };
    }
    try { await prepareLibraryWrite("tag-global-delete", { immediate: true }); }
    catch (error) { return { ok: false, error: error.message }; }

    const previousRegistry = new Map(tagRegistryIndex);
    const previousMetadata = new Map([...metadataIndex.entries()].map(([key, value]) => [key, structuredClone(value)]));
    let updatedCount = 0;
    tagRegistryIndex.delete(text);

    for (const [filePath, item] of metadataIndex.entries()) {
      const tags = Array.isArray(item?.Customization?.Tags) ? item.Customization.Tags : [];
      if (!tags.includes(text)) continue;
      const nextTags = tags.filter((tag) => tag !== text);
      item.Customization = {
        ...(item.Customization || {}),
        Tags: nextTags,
        MetadataUpdateDate: new Date().toISOString(),
      };
      delete item.Customization.Category;
      metadataIndex.set(filePath, item);
      updatedCount += 1;
    }

    try {
      await saveRegistryAndMetadataTransaction(
        DATA_FILE_NAMES.tags,
        [...tagRegistryIndex.values()].sort((a, b) => a.Text.localeCompare(b.Text, "zh-CN")),
        "tag-global-delete",
        updatedCount > 0,
      );
      return toSerializable({ ok: true, deleted: text, updatedCount, tags: listTagDefinitions() });
    } catch (error) {
      tagRegistryIndex = previousRegistry;
      metadataIndex = previousMetadata;
      appendLog(`Failed to delete tag globally: ${error.message}`);
      return { ok: false, error: "Failed to delete tag" };
    }
  });

  ipcMain.handle("person:list", async () => { requireOpenLibrary(); return toSerializable({ ok: true, people: listPersonDefinitions() }); });

  ipcMain.handle("person:create", async (_, payload) => {
    requireOpenLibrary({ writable: true });
    const name = normalizePersonName(payload?.name ?? payload?.Name);
    const description = normalizePersonName(payload?.description ?? payload?.Description);
    if (!name) {
      return { ok: false, error: "Person name is required" };
    }
    if (personRegistryIndex.has(name)) {
      return { ok: false, error: "Person already exists" };
    }

    const now = new Date().toISOString();
    const person = { Name: name, Description: description, CreatedAt: now, UpdatedAt: now };
    personRegistryIndex.set(name, person);
    try {
      await savePersonRegistryMap();
      return toSerializable({ ok: true, person: { ...person, UsageCount: 0 }, people: listPersonDefinitions() });
    } catch (error) {
      personRegistryIndex.delete(name);
      appendLog(`Failed to create person: ${error.message}`);
      return { ok: false, error: "Failed to write person registry" };
    }
  });

  ipcMain.handle("person:update-description", async (_, payload) => {
    requireOpenLibrary({ writable: true });
    const name = normalizePersonName(payload?.name ?? payload?.Name);
    const description = normalizePersonName(payload?.description ?? payload?.Description);
    const current = personRegistryIndex.get(name);
    if (!name) {
      return { ok: false, error: "Person name is required" };
    }
    if (!current) {
      return { ok: false, error: "Person not found" };
    }

    const previous = { ...current };
    const next = { ...current, Description: description, UpdatedAt: new Date().toISOString() };
    personRegistryIndex.set(name, next);
    try {
      await savePersonRegistryMap();
      return toSerializable({ ok: true, person: { ...next, UsageCount: getPersonUsageCounts().get(name) || 0 }, people: listPersonDefinitions() });
    } catch (error) {
      personRegistryIndex.set(name, previous);
      appendLog(`Failed to update person description: ${error.message}`);
      return { ok: false, error: "Failed to write person registry" };
    }
  });

  ipcMain.handle("person:delete-global", async (_, payload) => {
    requireOpenLibrary({ writable: true });
    const name = normalizePersonName(payload?.name ?? payload?.Name);
    const current = personRegistryIndex.get(name);
    if (!name || !current) {
      return { ok: false, error: "Person not found" };
    }
    try { await prepareLibraryWrite("person-global-delete", { immediate: true }); }
    catch (error) { return { ok: false, error: error.message }; }

    const previousRegistry = new Map(personRegistryIndex);
    const previousMetadata = new Map([...metadataIndex.entries()].map(([key, value]) => [key, structuredClone(value)]));
    let updatedCount = 0;
    personRegistryIndex.delete(name);

    for (const [filePath, item] of metadataIndex.entries()) {
      const people = Array.isArray(item?.Customization?.People) ? item.Customization.People : [];
      if (!people.includes(name)) continue;
      item.Customization = {
        ...(item.Customization || {}),
        People: people.filter((person) => person !== name),
        MetadataUpdateDate: new Date().toISOString(),
      };
      delete item.Customization.Category;
      metadataIndex.set(filePath, item);
      updatedCount += 1;
    }

    try {
      await saveRegistryAndMetadataTransaction(
        DATA_FILE_NAMES.people,
        [...personRegistryIndex.values()].sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN")),
        "person-global-delete",
        updatedCount > 0,
      );
      return toSerializable({ ok: true, deleted: name, updatedCount, people: listPersonDefinitions() });
    } catch (error) {
      personRegistryIndex = previousRegistry;
      metadataIndex = previousMetadata;
      appendLog(`Failed to delete person globally: ${error.message}`);
      return { ok: false, error: "Failed to delete person" };
    }
  });

  ipcMain.handle("location:list", async () => { requireOpenLibrary(); return toSerializable({ ok: true, locations: listLocationDefinitions() }); });

  ipcMain.handle("location:create", async (_, payload) => {
    requireOpenLibrary({ writable: true });
    const name = normalizeLocationName(payload?.name ?? payload?.Name);
    if (!name) {
      return { ok: false, error: "Location name is required" };
    }
    if (locationRegistryIndex.has(name)) {
      return { ok: false, error: "Location already exists" };
    }
    const parentValidation = validateLocationParent(name, payload?.parent ?? payload?.Parent);
    if (!parentValidation.ok) {
      return { ok: false, error: parentValidation.error };
    }

    const now = new Date().toISOString();
    const location = {
      Name: name,
      Country: normalizeLocationField(payload?.country ?? payload?.Country),
      Province: normalizeLocationField(payload?.province ?? payload?.Province),
      City: normalizeLocationField(payload?.city ?? payload?.City),
      Parent: parentValidation.parent,
      Description: normalizeLocationField(payload?.description ?? payload?.Description),
      CreatedAt: now,
      UpdatedAt: now,
    };
    locationRegistryIndex.set(name, location);
    try {
      await saveLocationRegistryMap();
      return toSerializable({ ok: true, location: { ...location, UsageCount: 0, Children: [], Depth: getLocationDepth(name), Path: buildLocationPath(name) }, locations: listLocationDefinitions() });
    } catch (error) {
      locationRegistryIndex.delete(name);
      appendLog(`Failed to create location: ${error.message}`);
      return { ok: false, error: "Failed to write location registry" };
    }
  });

  ipcMain.handle("location:update", async (_, payload) => {
    requireOpenLibrary({ writable: true });
    const name = normalizeLocationName(payload?.name ?? payload?.Name);
    const current = locationRegistryIndex.get(name);
    if (!name || !current) {
      return { ok: false, error: "Location not found" };
    }
    const parentValidation = validateLocationParent(name, payload?.parent ?? payload?.Parent);
    if (!parentValidation.ok) {
      return { ok: false, error: parentValidation.error };
    }

    const previous = { ...current };
    const next = {
      ...current,
      Country: normalizeLocationField(payload?.country ?? payload?.Country),
      Province: normalizeLocationField(payload?.province ?? payload?.Province),
      City: normalizeLocationField(payload?.city ?? payload?.City),
      Parent: parentValidation.parent,
      Description: normalizeLocationField(payload?.description ?? payload?.Description),
      UpdatedAt: new Date().toISOString(),
    };
    locationRegistryIndex.set(name, next);
    try {
      await saveLocationRegistryMap();
      return toSerializable({ ok: true, location: listLocationDefinitions().find((location) => location.Name === name), locations: listLocationDefinitions() });
    } catch (error) {
      locationRegistryIndex.set(name, previous);
      appendLog(`Failed to update location: ${error.message}`);
      return { ok: false, error: "Failed to write location registry" };
    }
  });

  ipcMain.handle("location:delete-global", async (_, payload) => {
    requireOpenLibrary({ writable: true });
    const name = normalizeLocationName(payload?.name ?? payload?.Name);
    const current = locationRegistryIndex.get(name);
    if (!name || !current) {
      return { ok: false, error: "Location not found" };
    }
    try { await prepareLibraryWrite("location-global-delete", { immediate: true }); }
    catch (error) { return { ok: false, error: error.message }; }

    const previousRegistry = new Map(locationRegistryIndex);
    const previousMetadata = new Map([...metadataIndex.entries()].map(([key, value]) => [key, structuredClone(value)]));
    let updatedCount = 0;
    let orphanedChildren = 0;
    const now = new Date().toISOString();
    locationRegistryIndex.delete(name);

    for (const [childName, location] of locationRegistryIndex.entries()) {
      if (normalizeLocationName(location.Parent) !== name) continue;
      locationRegistryIndex.set(childName, { ...location, Parent: "", UpdatedAt: now });
      orphanedChildren += 1;
    }

    for (const [filePath, item] of metadataIndex.entries()) {
      if (normalizeLocationName(item?.Location?.Place ?? item?.Location?.Site) !== name) continue;
      item.Location = { Place: "", Detail: "" };
      item.Customization = {
        ...(item.Customization || {}),
        MetadataUpdateDate: now,
      };
      metadataIndex.set(filePath, item);
      updatedCount += 1;
    }

    try {
      await saveRegistryAndMetadataTransaction(
        DATA_FILE_NAMES.locations,
        [...locationRegistryIndex.values()].sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN")),
        "location-global-delete",
        updatedCount > 0,
      );
      return toSerializable({ ok: true, deleted: name, updatedCount, orphanedChildren, locations: listLocationDefinitions() });
    } catch (error) {
      locationRegistryIndex = previousRegistry;
      metadataIndex = previousMetadata;
      appendLog(`Failed to delete location globally: ${error.message}`);
      return { ok: false, error: "Failed to delete location" };
    }
  });

  ipcMain.handle("album:list", async () => { requireOpenLibrary(); return toSerializable({ ok: true, albums: listAlbumDefinitions() }); });

  ipcMain.handle("album:create", async (_, payload) => {
    requireOpenLibrary({ writable: true });
    const title = normalizeAlbumTitle(payload?.title ?? payload?.Title);
    const description = normalizeAlbumTitle(payload?.description ?? payload?.Description);
    if (!title || !description) {
      return { ok: false, error: "Album title and description are required" };
    }
    if (albumRegistryIndex.has(title)) {
      return { ok: false, error: "Album already exists" };
    }

    const now = new Date().toISOString();
    const album = { Title: title, Description: description, CreatedAt: now, UpdatedAt: now };
    albumRegistryIndex.set(title, album);
    try {
      await saveAlbumRegistryMap();
      return toSerializable({ ok: true, album: { ...album, UsageCount: 0 }, albums: listAlbumDefinitions() });
    } catch (error) {
      albumRegistryIndex.delete(title);
      appendLog(`Failed to create album: ${error.message}`);
      return { ok: false, error: "Failed to write album registry" };
    }
  });

  ipcMain.handle("album:update-description", async (_, payload) => {
    requireOpenLibrary({ writable: true });
    const title = normalizeAlbumTitle(payload?.title ?? payload?.Title);
    const description = normalizeAlbumTitle(payload?.description ?? payload?.Description);
    const current = albumRegistryIndex.get(title);
    if (!title || !description) {
      return { ok: false, error: "Album title and description are required" };
    }
    if (!current) {
      return { ok: false, error: "Album not found" };
    }

    const previous = { ...current };
    const next = { ...current, Description: description, UpdatedAt: new Date().toISOString() };
    albumRegistryIndex.set(title, next);
    try {
      await saveAlbumRegistryMap();
      return toSerializable({ ok: true, album: { ...next, UsageCount: getAlbumUsageCounts().get(title) || 0 }, albums: listAlbumDefinitions() });
    } catch (error) {
      albumRegistryIndex.set(title, previous);
      appendLog(`Failed to update album description: ${error.message}`);
      return { ok: false, error: "Failed to write album registry" };
    }
  });

  ipcMain.handle("album:delete-global", async (_, payload) => {
    requireOpenLibrary({ writable: true });
    const title = normalizeAlbumTitle(payload?.title ?? payload?.Title);
    const current = albumRegistryIndex.get(title);
    if (!title || !current) {
      return { ok: false, error: "Album not found" };
    }
    try { await prepareLibraryWrite("album-global-delete", { immediate: true }); }
    catch (error) { return { ok: false, error: error.message }; }

    const previousRegistry = new Map(albumRegistryIndex);
    const previousMetadata = new Map([...metadataIndex.entries()].map(([key, value]) => [key, structuredClone(value)]));
    let updatedCount = 0;
    albumRegistryIndex.delete(title);

    for (const [filePath, item] of metadataIndex.entries()) {
      if (normalizeAlbumTitle(item?.Customization?.Album) !== title) continue;
      item.Customization = {
        ...(item.Customization || {}),
        Album: "",
        MetadataUpdateDate: new Date().toISOString(),
      };
      delete item.Customization.Category;
      metadataIndex.set(filePath, item);
      updatedCount += 1;
    }

    try {
      await saveRegistryAndMetadataTransaction(
        DATA_FILE_NAMES.albums,
        [...albumRegistryIndex.values()].sort((a, b) => a.Title.localeCompare(b.Title, "zh-CN")),
        "album-global-delete",
        updatedCount > 0,
      );
      return toSerializable({ ok: true, deleted: title, updatedCount, albums: listAlbumDefinitions() });
    } catch (error) {
      albumRegistryIndex = previousRegistry;
      metadataIndex = previousMetadata;
      appendLog(`Failed to delete album globally: ${error.message}`);
      return { ok: false, error: "Failed to delete album" };
    }
  });

  ipcMain.handle("photo:update-customization", async (_, payload) => {
    requireOpenLibrary({ writable: true });
    const { filePath, customization, location } = payload;
    const current = metadataIndex.get(filePath);

    if (!current) {
      return { ok: false, error: "Metadata item not found" };
    }
    const previous = structuredClone(current);

    if (Object.prototype.hasOwnProperty.call(customization || {}, "Tags")) {
      const validation = normalizeRegisteredTags(customization.Tags);
      if (validation.unknown.length) {
        return { ok: false, error: `Unknown tag: ${validation.unknown.join(", ")}` };
      }
      customization.Tags = validation.tags;
    }

    if (Object.prototype.hasOwnProperty.call(customization || {}, "Album")) {
      const validation = normalizeRegisteredAlbum(customization.Album);
      if (validation.unknown.length) {
        return { ok: false, error: `Unknown album: ${validation.unknown.join(", ")}` };
      }
      customization.Album = validation.album;
    }

    if (Object.prototype.hasOwnProperty.call(customization || {}, "People")) {
      const validation = normalizeRegisteredPeople(customization.People);
      if (validation.unknown.length) {
        return { ok: false, error: `Unknown person: ${validation.unknown.join(", ")}` };
      }
      customization.People = validation.people;
    }

    let normalizedLocation = null;
    if (location && typeof location === "object") {
      const validation = normalizeRegisteredLocation(location);
      if (validation.unknown.length) {
        return { ok: false, error: `Unknown location: ${validation.unknown.join(", ")}` };
      }
      normalizedLocation = validation.location;
    }

    // Merge user edits and stamp update time.
    current.Customization = {
      ...current.Customization,
      ...customization,
      MetadataUpdateDate: new Date().toISOString(),
    };
    delete current.Customization.Category;
    if (normalizedLocation) {
      current.Location = normalizedLocation;
    }

    metadataIndex.set(filePath, current);

    try {
      await saveMetadataMap();
      return toSerializable({ ok: true, item: enrichItem(current) });
    } catch (error) {
      metadataIndex.set(filePath, previous);
      appendLog(`Failed to write metadata: ${error.message}`);
      return { ok: false, error: "Failed to write metadata" };
    }
  });

  ipcMain.handle("photo:batch-update", async (_, payload) => {
    requireOpenLibrary({ writable: true });
    const filePaths = Array.isArray(payload?.filePaths) ? payload.filePaths : [];
    const addTags = Array.isArray(payload?.addTags) ? payload.addTags : [];
    const addPeople = Array.isArray(payload?.addPeople) ? payload.addPeople : [];
    const locationPatch = payload?.locationPatch && typeof payload.locationPatch === "object" ? payload.locationPatch : {};
    const customizationPatch = payload?.customizationPatch && typeof payload.customizationPatch === "object" ? payload.customizationPatch : {};

    if (!filePaths.length) {
      return { ok: false, error: "No target file paths" };
    }

    const dedupTags = [...new Set(addTags.map((x) => String(x || "").trim()).filter(Boolean))];
    const validation = normalizeRegisteredTags(dedupTags);
    if (validation.unknown.length) {
      return { ok: false, error: `Unknown tag: ${validation.unknown.join(", ")}` };
    }
    const dedupPeople = [...new Set(addPeople.map((x) => String(x || "").trim()).filter(Boolean))];
    const peopleValidation = normalizeRegisteredPeople(dedupPeople);
    if (peopleValidation.unknown.length) {
      return { ok: false, error: `Unknown person: ${peopleValidation.unknown.join(", ")}` };
    }
    if (Object.prototype.hasOwnProperty.call(customizationPatch, "Album")) {
      const albumValidation = normalizeRegisteredAlbum(customizationPatch.Album);
      if (albumValidation.unknown.length) {
        return { ok: false, error: `Unknown album: ${albumValidation.unknown.join(", ")}` };
      }
      customizationPatch.Album = albumValidation.album;
    }
    let normalizedLocationPatch = null;
    if (Object.prototype.hasOwnProperty.call(locationPatch, "Place")) {
      const locationValidation = normalizeRegisteredLocation({ Place: locationPatch.Place, Detail: "" });
      if (locationValidation.unknown.length) {
        return { ok: false, error: `Unknown location: ${locationValidation.unknown.join(", ")}` };
      }
      normalizedLocationPatch = locationValidation.location;
    }
    const updatedItems = [];
    const previousItems = new Map();
    const requestedCount = filePaths.length;
    let missingCount = 0;

    for (const filePath of filePaths) {
      const current = metadataIndex.get(filePath);
      if (!current) {
        missingCount += 1;
        continue;
      }
      previousItems.set(filePath, structuredClone(current));

      const currentTags = Array.isArray(current?.Customization?.Tags) ? current.Customization.Tags : [];
      const mergedTags = [...currentTags];
      for (const tag of validation.tags) {
        if (!mergedTags.includes(tag)) mergedTags.push(tag);
      }

      const currentPeople = Array.isArray(current?.Customization?.People) ? current.Customization.People : [];
      const mergedPeople = [...currentPeople];
      for (const person of peopleValidation.people) {
        if (!mergedPeople.includes(person)) mergedPeople.push(person);
      }

      current.Customization = {
        ...current.Customization,
        ...customizationPatch,
        Tags: mergedTags,
        People: mergedPeople,
        MetadataUpdateDate: new Date().toISOString(),
      };
      delete current.Customization.Category;

      current.Location = normalizeLocationObject(current.Location);
      if (normalizedLocationPatch) {
        current.Location.Place = normalizedLocationPatch.Place;
      }

      metadataIndex.set(filePath, current);
      updatedItems.push(enrichItem(current));
    }

    try {
      if (updatedItems.length) await saveMetadataMap();
      return toSerializable({
        ok: true,
        requestedCount,
        updatedCount: updatedItems.length,
        missingCount,
        items: updatedItems,
      });
    } catch (error) {
      for (const [filePath, previous] of previousItems) metadataIndex.set(filePath, previous);
      appendLog(`Failed to batch-write metadata: ${error.message}`);
      return { ok: false, error: "Failed to write metadata" };
    }
  });

  ipcMain.handle("photo:copy-path", async (_, filePath) => {
    try {
      const { absolutePath } = resolveIndexedMediaPath(filePath);
      clipboard.writeText(absolutePath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("clipboard:write-text", async (_, value) => {
    clipboard.writeText(String(value ?? ""));
    return { ok: true };
  });

  ipcMain.handle("photo:copy-json", async (_, filePath) => {
    try {
      const { item } = resolveIndexedMediaPath(filePath);
      clipboard.writeText(JSON.stringify(item, null, 2));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("photo:copy-image", async (_, filePath) => {
    try {
      const resolved = resolveIndexedMediaPath(filePath);
      if (resolved.item?.FileSystem?.FileType !== "image") return { ok: false, error: "Only images can be copied" };
      const image = nativeImage.createFromPath(resolved.absolutePath);
      if (image.isEmpty()) return { ok: false, error: "Image load failed" };
      clipboard.writeImage(image);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("photo:open-default", async (_, filePath) => {
    try {
      const { absolutePath } = resolveIndexedMediaPath(filePath);
      const errorMessage = await shell.openPath(absolutePath);
      return errorMessage ? { ok: false, error: errorMessage } : { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("photo:show-in-folder", async (_, filePath) => {
    try {
      const { absolutePath } = resolveIndexedMediaPath(filePath);
      shell.showItemInFolder(absolutePath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("photo:report-playback", async (_, payload) => {
    const filePath = String(payload?.filePath || "").replace(/\\/g, "/");
    if (!metadataIndex.has(filePath)) return { ok: false };
    const mode = String(payload?.mode || "unknown").slice(0, 40);
    const message = String(payload?.message || "").replace(/\s+/g, " ").slice(0, 240);
    appendLog(`playback-fallback file=${filePath} mode=${mode} message=${message}`);
    return { ok: true };
  });

  ipcMain.handle("thumbnail:start-warmup", async () => {
    warmupThumbnailCache().catch((error) => appendLog(`thumbnail-warmup failed: ${error.message}`));
    return { ok: true };
  });

  ipcMain.handle("window:action", async (_, action) => {
    if (!mainWindow) return;
    if (action === "minimize") mainWindow.minimize();
    if (action === "maximize") mainWindow.maximize();
    if (action === "restore") mainWindow.unmaximize();
    if (action === "close") mainWindow.close();
  });

  ipcMain.handle("window:get-state", async () => ({
    isMaximized: Boolean(mainWindow?.isMaximized()),
  }));
}

/**
 * App bootstrap sequence:
 * 1) load app-level config and last-library state
 * 2) validate media tools without opening a library
 * 3) create BrowserWindow and bind diagnostics
 * 4) load the renderer entry; renderer may then request last-library open
 */
async function bootstrap() {
  ensureConfig();
  await loadAppState();
  await checkMediaTools();

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep sandbox disabled for this local desktop app setup to ensure
      // preload bridge works consistently in current environment.
      sandbox: false,
    },
  });

  // Renderer diagnostics: helps investigate blank-screen and startup issues quickly.
  mainWindow.webContents.on("did-fail-load", (_, errorCode, errorDescription, validatedURL) => {
    const msg = `did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedURL}`;
    console.error(msg);
    appendLog(msg);
  });

  mainWindow.webContents.on("render-process-gone", (_, details) => {
    const msg = `render-process-gone reason=${details?.reason} exitCode=${details?.exitCode}`;
    console.error(msg);
    appendLog(msg);
  });

  mainWindow.webContents.on("unresponsive", () => {
    const msg = "renderer became unresponsive";
    console.error(msg);
    appendLog(msg);
  });

  mainWindow.webContents.on("console-message", (_, level, message, line, sourceId) => {
    const msg = `renderer-console [${level}] ${message} @ ${sourceId}:${line}`;
    console.log(msg);
    appendLog(msg);
  });

  const emitWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("window:state-changed", {
      isMaximized: mainWindow.isMaximized(),
    });
  };
  mainWindow.on("maximize", emitWindowState);
  mainWindow.on("unmaximize", emitWindowState);
  mainWindow.on("enter-full-screen", emitWindowState);
  mainWindow.on("leave-full-screen", emitWindowState);
  mainWindow.on("close", (event) => {
    if (maintenanceState.running) {
      event.preventDefault();
      dialog.showMessageBoxSync(mainWindow, {
        type: "warning",
        title: "维护任务仍在运行",
        message: "当前图库维护任务不能取消。请等待任务完成后再关闭应用。",
        buttons: ["确定"],
      });
      return;
    }
    if (activeWorker && activeWorkerOperation === "initialize") {
      event.preventDefault();
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: "warning",
        title: "取消图库初始化",
        message: "图库仍在初始化。关闭应用将取消初始化并删除本轮创建的全部未完成数据。是否继续？",
        buttons: ["继续初始化", "取消初始化并关闭"],
        defaultId: 0,
        cancelId: 0,
      });
      if (choice === 1) {
        pendingAppClose = true;
        activeWorker.send({ type: "cancel" });
      }
    }
  });

  if (fs.existsSync(RENDERER_INDEX_PATH)) {
    await mainWindow.loadFile(RENDERER_INDEX_PATH);
  } else {
    const message = "Renderer bundle not found. Run `npm run build:renderer` first.";
    appendLog(message);
    await mainWindow.loadURL(
      `data:text/html;charset=UTF-8,${encodeURIComponent(
        `<h2 style="font-family:Segoe UI, Arial, sans-serif; padding: 20px;">${message}</h2>`,
      )}`,
    );
  }
  emitWindowState();
}

// Standard Electron lifecycle.
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else app.whenReady().then(async () => {
  registerIpcHandlers();
  await bootstrap();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await bootstrap();
    }
  });
});

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (activeLibrary) {
    const closing = activeLibrary;
    activeLibrary = null;
    try {
      const current = JSON.parse(fs.readFileSync(closing.paths.lockFile, "utf8"));
      if (current?.SessionId === closing.sessionId) fs.rmSync(closing.paths.lockFile, { force: true });
    } catch {
      // Best-effort synchronous cleanup during application shutdown.
    }
  }
});
