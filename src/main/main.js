/**
 * Electron main-process entry.
 *
 * Responsibilities:
 * 1) Load and normalize runtime configuration.
 * 2) Load photo metadata index (JSONL -> in-memory Map).
 * 3) Serve IPC handlers for query/update/copy/window actions.
 * 4) Create and monitor the renderer window.
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { fork } = require("node:child_process");
const {
  applyConfigPatch,
  loadConfig,
  saveConfig: persistConfig,
} = require("./application-config.js");
const {
  createLocationDomain,
  normalizeLocationField,
  normalizeLocationName,
  normalizeLocationObject,
} = require("./location-domain.js");
const { createGalleryQueryService } = require("./gallery-query.js");
const { createSimpleRegistryService } = require("./simple-registry-service.js");
const { createSimpleRegistryCatalog } = require("./simple-registry-catalog.js");
const { createLocationCatalog } = require("./location-catalog.js");
const { createLocationRegistryService } = require("./location-registry-service.js");
const { createMetadataEditService } = require("./metadata-edit-service.js");
const { registerIpcHandlers: registerMainIpcHandlers } = require("./ipc-handlers.js");
const { createMainWindow } = require("./window-manager.js");
const { createApplicationRuntime } = require("./application-runtime.js");
const { createThumbnailWarmupService } = require("./thumbnail-warmup-service.js");
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

const state = createApplicationRuntime();
let config = null;
let appState = { lastLibraryPath: "" };
let applicationStartedAt = new Date().toISOString();
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

function resolveDataDir() {
  if (!state.activeLibrary) {
    const error = new Error("No library is open");
    error.code = "LIBRARY_NOT_OPEN";
    throw error;
  }
  return state.activeLibrary.paths.dataDir;
}

function resolveDataFile(fileName) {
  return path.join(resolveDataDir(), fileName);
}

/**
 * Append one line into date-partitioned log file under configured log directory.
 */
function appendLog(message) {
  try {
    const logDir = state.activeLibrary?.paths?.logDir || path.join(app.getPath("userData"), "logs");
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
  if (!state.activeLibrary || state.activeLibrary.state !== "open") {
    const error = new Error("No library is open");
    error.code = "LIBRARY_NOT_OPEN";
    throw error;
  }
  if (writable && state.maintenanceState.running) {
    const error = new Error("The library is read-only while maintenance is running");
    error.code = "MAINTENANCE_RUNNING";
    throw error;
  }
  return state.activeLibrary;
}

/**
 * Read metadata JSONL into an in-memory Map keyed by FilePath.
 * Strict parsing deliberately rejects malformed or duplicate records so an
 * inconsistent library never opens as if it were healthy.
 */
async function loadMetadataIndex() {
  state.metadataIndex.clear();
  const metadataFile = resolveDataFile(DATA_FILE_NAMES.metadata);
  const entries = await readJsonlStrict(metadataFile, {
    label: DATA_FILE_NAMES.metadata,
    keyOf: (item) => item?.FilePath,
  });
  for (const item of entries) {
    assertPathInsideLibrary(state.activeLibrary.paths, path.join(state.activeLibrary.paths.root, item.FilePath));
    state.metadataIndex.set(item.FilePath, item);
  }
}

/**
 * Normalize tag text into the canonical key stored in photo metadata.
 */
function normalizeTagText(value) {
  return String(value ?? "").trim();
}

function normalizePersonName(value) {
  return String(value ?? "").trim();
}

function normalizeAlbumTitle(value) {
  return String(value ?? "").trim();
}

async function prepareLibraryWrite(reason, { immediate = false } = {}) {
  const library = state.activeLibrary;
  if (!library || !["opening", "open"].includes(library.state)) throw new Error("No writable library session is active");
  if (state.maintenanceState.running) throw new Error("The library is read-only while maintenance is running");
  await createLibraryBackup(library.paths, {
    kind: immediate ? "immediate" : "daily",
    reason,
    retentionCount: config.backup.retentionCount,
  });
}

async function touchLibraryManifest() {
  if (!state.activeLibrary) return;
  const nextManifest = { ...state.activeLibrary.manifest, updatedAt: new Date().toISOString() };
  try {
    state.activeLibrary.manifest = await writeLibraryManifest(state.activeLibrary.paths, nextManifest);
  } catch (error) {
    // The JSONL commit is already durable at this point. updatedAt is advisory,
    // so a manifest timestamp failure must not make memory diverge from disk.
    appendLog(`library manifest timestamp update failed: ${error.message}`);
  }
}

const tagCatalog = createSimpleRegistryCatalog({
  definitionKey: "Text",
  invalidKeyLabel: "tag key",
  dataFileName: DATA_FILE_NAMES.tags,
  defaultDescription: DEFAULT_TAG_DESCRIPTION,
  backupReason: "tag-registry-write",
  normalize: normalizeTagText,
  extractReferences: (item) => Array.isArray(item?.Customization?.Tags) ? item.Customization.Tags : [],
  getRegistry: () => state.tagRegistryIndex,
  getMetadata: () => state.metadataIndex,
  resolveDataFile,
  prepareLibraryWrite,
  touchLibraryManifest,
  readJsonlStrict,
  writeJsonlAtomic,
});
const personCatalog = createSimpleRegistryCatalog({
  definitionKey: "Name",
  invalidKeyLabel: "person key",
  dataFileName: DATA_FILE_NAMES.people,
  defaultDescription: "",
  backupReason: "person-registry-write",
  normalize: normalizePersonName,
  extractReferences: (item) => Array.isArray(item?.Customization?.People) ? item.Customization.People : [],
  getRegistry: () => state.personRegistryIndex,
  getMetadata: () => state.metadataIndex,
  resolveDataFile,
  prepareLibraryWrite,
  touchLibraryManifest,
  readJsonlStrict,
  writeJsonlAtomic,
});
const albumCatalog = createSimpleRegistryCatalog({
  definitionKey: "Title",
  invalidKeyLabel: "album key",
  dataFileName: DATA_FILE_NAMES.albums,
  defaultDescription: DEFAULT_ALBUM_DESCRIPTION,
  backupReason: "album-registry-write",
  normalize: normalizeAlbumTitle,
  normalizeLoadedDescription: (value) => normalizeAlbumTitle(value) || DEFAULT_ALBUM_DESCRIPTION,
  extractReferences: (item) => {
    const album = item?.Customization?.Album;
    return album ? [album] : [];
  },
  getRegistry: () => state.albumRegistryIndex,
  getMetadata: () => state.metadataIndex,
  resolveDataFile,
  prepareLibraryWrite,
  touchLibraryManifest,
  readJsonlStrict,
  writeJsonlAtomic,
});
const {
  buildLocationPath,
  getLocationChildrenMap,
  getLocationDepth,
  getLocationDescendants,
  validateLocationParent,
} = createLocationDomain(() => state.locationRegistryIndex);
const locationCatalog = createLocationCatalog({
  dataFileName: DATA_FILE_NAMES.locations,
  getRegistry: () => state.locationRegistryIndex,
  getMetadata: () => state.metadataIndex,
  normalizeName: normalizeLocationName,
  normalizeField: normalizeLocationField,
  normalizeObject: normalizeLocationObject,
  getChildrenMap: getLocationChildrenMap,
  getDepth: getLocationDepth,
  buildPath: buildLocationPath,
  validateParent: validateLocationParent,
  resolveDataFile,
  prepareLibraryWrite,
  touchLibraryManifest,
  readJsonlStrict,
  writeJsonlAtomic,
  saveTransaction: saveRegistryAndMetadataTransaction,
  saveMetadata: saveMetadataMap,
});

const listTagDefinitions = tagCatalog.listDefinitions;
const getTagUsageCounts = tagCatalog.getUsageCounts;
const saveTagRegistryMap = tagCatalog.save;
const loadTagRegistryIndex = tagCatalog.load;
const listPersonDefinitions = personCatalog.listDefinitions;
const getPersonUsageCounts = personCatalog.getUsageCounts;
const savePersonRegistryMap = personCatalog.save;
const loadPersonRegistryIndex = personCatalog.load;
const listAlbumDefinitions = albumCatalog.listDefinitions;
const getAlbumUsageCounts = albumCatalog.getUsageCounts;
const saveAlbumRegistryMap = albumCatalog.save;
const loadAlbumRegistryIndex = albumCatalog.load;
const getLocationUsageCounts = locationCatalog.getUsageCounts;
const listLocationDefinitions = locationCatalog.listDefinitions;
const saveLocationRegistryMap = locationCatalog.save;
const loadLocationRegistryIndex = locationCatalog.load;
const normalizeRegisteredLocation = locationCatalog.normalizeRegistered;

function normalizeRegisteredTags(rawTags) {
  const validation = tagCatalog.validateMany(rawTags);
  return { tags: validation.values, unknown: validation.unknown };
}

function normalizeRegisteredPeople(rawPeople) {
  const validation = personCatalog.validateMany(rawPeople);
  return { people: validation.values, unknown: validation.unknown };
}

function normalizeRegisteredAlbum(rawAlbum) {
  const validation = albumCatalog.validateOne(rawAlbum);
  return { album: validation.value, unknown: validation.unknown };
}

const { filterAndSort } = createGalleryQueryService({
  getLocationDescendants,
  normalizeAlbumTitle,
  normalizeLocationName,
  unassignedAlbumFilter: UNASSIGNED_ALBUM_FILTER,
});

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
  const item = state.metadataIndex.get(filePath);
  if (!item) throw new Error("Media record not found");
  const library = requireOpenLibrary();
  const absolutePath = assertPathInsideLibrary(library.paths, path.join(library.paths.root, item.FilePath));
  if (!fs.existsSync(absolutePath)) throw new Error("Media file not found");
  return { item, absolutePath };
}

const thumbnailWarmupService = createThumbnailWarmupService({
  state,
  getConfig: () => config,
  normalizeThumbnailConfig,
  ensureThumbnailsForItems,
  buildThumbnailManifest,
  thumbnailManifestMatches,
  writeTextAtomic,
  appendLog,
});
const warmupThumbnailCache = thumbnailWarmupService.warmup;

/**
 * Persist full metadata Map back to JSONL using atomic replace:
 * write temp file -> rename.
 */
async function saveMetadataMap(options = {}) {
  if (options.backup !== false) await prepareLibraryWrite(options.reason || "metadata-write", { immediate: Boolean(options.immediate) });
  const metadataFile = resolveDataFile(DATA_FILE_NAMES.metadata);
  await writeJsonlAtomic(metadataFile, state.metadataIndex.values());
  await touchLibraryManifest();
}

async function saveRegistryAndMetadataTransaction(registryFileName, registryEntries, reason, includeMetadata) {
  const library = state.activeLibrary;
  if (!library || !["opening", "open"].includes(library.state)) throw new Error("No writable library session is active");
  if (state.maintenanceState.running) throw new Error("The library is read-only while maintenance is running");
  const changes = [{
    filePath: resolveDataFile(registryFileName),
    entries: registryEntries,
  }];
  if (includeMetadata) {
    changes.push({
      filePath: resolveDataFile(DATA_FILE_NAMES.metadata),
      entries: state.metadataIndex.values(),
    });
  }
  await commitJsonlTransaction(library.paths, changes, { reason });
  await touchLibraryManifest();
}

function clearLibraryIndexes() {
  state.metadataIndex.clear();
  state.tagRegistryIndex.clear();
  state.albumRegistryIndex.clear();
  state.personRegistryIndex.clear();
  state.locationRegistryIndex.clear();
}

function emitLibraryState(extra = {}) {
  if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
  state.mainWindow.webContents.send("library:state-changed", toSerializable(getLibraryState(extra)));
}

function getLibraryState(extra = {}) {
  return {
    state: state.activeLibrary?.state || "closed",
    active: state.activeLibrary ? {
      root: state.activeLibrary.paths.root,
      name: state.activeLibrary.manifest.name,
      libraryId: state.activeLibrary.manifest.libraryId,
      createdAt: state.activeLibrary.manifest.createdAt,
      updatedAt: state.activeLibrary.manifest.updatedAt,
      mediaCount: state.metadataIndex.size,
      imageCount: [...state.metadataIndex.values()].filter((item) => item?.FileSystem?.FileType === "image").length,
      videoCount: [...state.metadataIndex.values()].filter((item) => item?.FileSystem?.FileType === "video").length,
    } : null,
    lastLibraryPath: appState.lastLibraryPath,
    mediaTools: state.mediaToolsState,
    maintenance: state.maintenanceState,
    ...extra,
  };
}

async function checkMediaTools() {
  try {
    const tools = await validateMediaTools(APP_ROOT, config.media);
    state.mediaToolsState = { available: true, error: "", versions: tools.versions };
    appendLog(`media-tools ${tools.versions.ffmpeg}; ${tools.versions.ffprobe}`);
  } catch (error) {
    const reason = sanitizeMediaError(error, error?.path || "");
    state.mediaToolsState = { available: false, error: reason, versions: null };
    appendLog(`media-tools validation failed: ${reason}`);
  }
  emitLibraryState();
  return state.mediaToolsState;
}

async function loadAllLibraryIndexes() {
  await loadMetadataIndex();
  await loadTagRegistryIndex();
  await loadAlbumRegistryIndex();
  await loadPersonRegistryIndex();
  await loadLocationRegistryIndex();
  const hashes = new Map();
  for (const item of state.metadataIndex.values()) {
    if (!item.SHA256Hash) continue;
    if (!hashes.has(item.SHA256Hash)) hashes.set(item.SHA256Hash, []);
    hashes.get(item.SHA256Hash).push(item.FilePath);
  }
  for (const [hash, filePaths] of hashes) {
    if (filePaths.length > 1) appendLog(`duplicate-sha256 hash=${hash} files=${filePaths.sort().join("|")}`);
  }
}

async function openLibrary(rawRoot, options = {}) {
  if (!state.mediaToolsState.available) {
    const error = new Error(`FFmpeg 媒体工具不可用：${state.mediaToolsState.error}`);
    error.code = "MEDIA_TOOLS_UNAVAILABLE";
    throw error;
  }
  if (state.maintenanceState.running) {
    const error = new Error("A maintenance operation is running");
    error.code = "MAINTENANCE_RUNNING";
    throw error;
  }
  if (state.activeWorker) {
    const error = new Error("A library operation is already running");
    error.code = "MAINTENANCE_RUNNING";
    throw error;
  }
  if (state.activeLibrary) await closeLibrary({ preserveLastPath: true });
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
      onProgress: (progress) => state.mainWindow?.webContents.send("library:progress", toSerializable(progress)),
    });
    lock = await acquireLibraryLock(paths, manifest, {
      force: Boolean(options.force),
      applicationStartedAt,
    });
    state.activeLibrary = { state: "opening", sessionId: lock.SessionId, paths, manifest, lock };
    const recovery = await recoverPendingTransaction(paths);
    if (recovery.recovered) appendLog(`library-transaction ${recovery.action} reason=${recovery.reason || "unknown"}`);
    await loadAllLibraryIndexes();
    if (marker?.Status === "committed") await fsp.rm(paths.initializationFile, { force: true });
    state.activeLibrary.state = "open";
    state.thumbnailWarmupStarted = false;
    appState.lastLibraryPath = paths.root;
    await saveAppState().catch((error) => appendLog(`app-state write failed: ${error.message}`));
    emitLibraryState();
    return getLibraryState();
  } catch (error) {
    if (lock) await releaseLibraryLock(paths, lock.SessionId).catch(() => {});
    state.activeLibrary = null;
    clearLibraryIndexes();
    emitLibraryState({ error: error.message });
    throw error;
  }
}

async function closeLibrary(options = {}) {
  if (state.maintenanceState.running) {
    const error = new Error("Cannot close the library while maintenance is running");
    error.code = "MAINTENANCE_RUNNING";
    throw error;
  }
  if (!state.activeLibrary) return getLibraryState();
  state.activeLibrary.state = "closing";
  emitLibraryState();
  const closing = state.activeLibrary;
  if (state.thumbnailWarmupToken?.sessionId === closing.sessionId) state.thumbnailWarmupToken.cancelled = true;
  state.thumbnailWarmupToken = null;
  state.activeLibrary = null;
  state.thumbnailWarmupStarted = false;
  clearLibraryIndexes();
  await releaseLibraryLock(closing.paths, closing.sessionId).catch((error) => appendLog(`lock-release failed: ${error.message}`));
  if (!options.preserveLastPath) {
    // Returning to the entry screen intentionally keeps lastLibraryPath for the next launch.
  }
  emitLibraryState();
  return getLibraryState();
}

async function inspectLibraryDirectory(rawRoot) {
  if (!state.mediaToolsState.available) {
    const error = new Error(`FFmpeg 媒体工具不可用：${state.mediaToolsState.error}`);
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
  state.quickScanState = { cancelled: false };
  try {
    const files = await walkFiles(paths.root, {
      isCancelled: () => state.quickScanState?.cancelled,
      onProgress: ({ visitedDirectories, current }) => state.mainWindow?.webContents.send("library:progress", {
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
    state.quickScanState = null;
  }
}

function runOperationWorker(operation, root, options = {}) {
  if (state.activeWorker) {
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
      PHOTO_MANAGER_LIBRARY_SESSION: operation === "initialize" ? "" : state.activeLibrary?.sessionId || "",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  state.activeWorker = worker;
  state.activeWorkerOperation = operation;
  return new Promise((resolve, reject) => {
    let result = null;
    let failure = null;
    worker.stdout?.on("data", (chunk) => appendOperationLog(operation, root, `worker-${operation} ${String(chunk).trim()}`));
    worker.stderr?.on("data", (chunk) => appendOperationLog(operation, root, `worker-${operation}-stderr ${String(chunk).trim()}`));
    worker.on("message", (message) => {
      if (message?.type === "progress" || message?.type === "log") {
        state.maintenanceState.progress = message;
        if (message.message) appendOperationLog(operation, root, `worker-${operation} ${message.level || "info"}: ${message.message}`);
        state.mainWindow?.webContents.send(operation === "initialize" ? "library:progress" : "maintenance:progress", toSerializable(message));
      }
      if (message?.type === "result") result = message.result;
      if (message?.type === "failure") failure = message.error;
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      state.activeWorker = null;
      state.activeWorkerOperation = "";
      if (state.pendingAppClose) {
        state.pendingAppClose = false;
        setImmediate(() => {
          state.mainWindow?.destroy();
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
  if (state.thumbnailWarmupToken?.sessionId === library.sessionId) state.thumbnailWarmupToken.cancelled = true;
  state.thumbnailWarmupToken = null;
  state.maintenanceState = { running: true, operation, progress: null, report: null };
  state.thumbnailWarmupStarted = false;
  let updateCompleted = false;
  emitLibraryState();
  try {
    const result = await runOperationWorker(operation, library.paths.root, options);
    state.maintenanceState.report = result;
    if (operation === "update") {
      // The child process has released its operation lock. Clear the read-only
      // flag before reloading because legacy registry backfill may persist data.
      state.maintenanceState.running = false;
      await loadAllLibraryIndexes();
      updateCompleted = true;
    }
    state.mainWindow?.webContents.send("maintenance:completed", { ok: true, operation, result });
    return { ok: true, result };
  } catch (error) {
    appendLog(`maintenance-${operation} failed: ${error.stack || error.message}`);
    state.mainWindow?.webContents.send("maintenance:completed", { ok: false, operation, error: error.message });
    return { ok: false, error: error.message, code: error.code };
  } finally {
    state.maintenanceState.running = false;
    state.maintenanceState.operation = "";
    emitLibraryState();
    if (updateCompleted) warmupThumbnailCache().catch((error) => appendLog(`thumbnail-warmup failed: ${error.message}`));
  }
}

function queryGallery(query) {
  requireOpenLibrary();
  const all = [...state.metadataIndex.values()].map(enrichItem);
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
    if (!grouped.has(item.__groupDate)) grouped.set(item.__groupDate, []);
    grouped.get(item.__groupDate).push(item);
  }
  const unassignedAlbumCount = all.filter((item) => !normalizeAlbumTitle(item?.Customization?.Album)).length;
  return {
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
      albums: [...state.albumRegistryIndex.keys()].sort((a, b) => a.localeCompare(b, "zh-CN")),
      unassignedAlbumCount,
      tags: [...state.tagRegistryIndex.keys()].sort((a, b) => a.localeCompare(b, "zh-CN")),
      people: [...state.personRegistryIndex.keys()].sort((a, b) => a.localeCompare(b, "zh-CN")),
      locations: listLocationDefinitions(),
    },
  };
}

function createDomainServices() {
  const commonRegistryOptions = {
    getMetadata: () => state.metadataIndex,
    setMetadata: (next) => { state.metadataIndex = next; },
    requireOpenLibrary,
    prepareLibraryWrite,
    saveTransaction: saveRegistryAndMetadataTransaction,
    appendLog,
  };
  const tagService = createSimpleRegistryService({
    ...commonRegistryOptions,
    kind: "Tag",
    keyLabel: "Tag text",
    definitionKey: "Text",
    responseItemKey: "tag",
    responseListKey: "tags",
    dataFileName: DATA_FILE_NAMES.tags,
    descriptionRequired: false,
    normalize: normalizeTagText,
    readKey: (payload) => payload?.text ?? payload?.Text,
    readDescription: (payload) => payload?.description ?? payload?.Description,
    getRegistry: () => state.tagRegistryIndex,
    setRegistry: (next) => { state.tagRegistryIndex = next; },
    saveRegistry: saveTagRegistryMap,
    listDefinitions: listTagDefinitions,
    getUsageCounts: getTagUsageCounts,
    sortEntries: (values) => [...values].sort((a, b) => a.Text.localeCompare(b.Text, "zh-CN")),
    mutateMetadataOnDelete: (item, text) => {
      const tags = Array.isArray(item?.Customization?.Tags) ? item.Customization.Tags : [];
      if (!tags.includes(text)) return false;
      item.Customization = {
        ...(item.Customization || {}),
        Tags: tags.filter((tag) => tag !== text),
        MetadataUpdateDate: new Date().toISOString(),
      };
      delete item.Customization.Category;
      return true;
    },
  });
  const personService = createSimpleRegistryService({
    ...commonRegistryOptions,
    kind: "Person",
    keyLabel: "Person name",
    definitionKey: "Name",
    responseItemKey: "person",
    responseListKey: "people",
    dataFileName: DATA_FILE_NAMES.people,
    descriptionRequired: false,
    normalize: normalizePersonName,
    readKey: (payload) => payload?.name ?? payload?.Name,
    readDescription: (payload) => payload?.description ?? payload?.Description,
    getRegistry: () => state.personRegistryIndex,
    setRegistry: (next) => { state.personRegistryIndex = next; },
    saveRegistry: savePersonRegistryMap,
    listDefinitions: listPersonDefinitions,
    getUsageCounts: getPersonUsageCounts,
    sortEntries: (values) => [...values].sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN")),
    mutateMetadataOnDelete: (item, name) => {
      const people = Array.isArray(item?.Customization?.People) ? item.Customization.People : [];
      if (!people.includes(name)) return false;
      item.Customization = {
        ...(item.Customization || {}),
        People: people.filter((person) => person !== name),
        MetadataUpdateDate: new Date().toISOString(),
      };
      delete item.Customization.Category;
      return true;
    },
  });
  const albumService = createSimpleRegistryService({
    ...commonRegistryOptions,
    kind: "Album",
    keyLabel: "Album title",
    definitionKey: "Title",
    responseItemKey: "album",
    responseListKey: "albums",
    dataFileName: DATA_FILE_NAMES.albums,
    descriptionRequired: true,
    normalize: normalizeAlbumTitle,
    readKey: (payload) => payload?.title ?? payload?.Title,
    readDescription: (payload) => payload?.description ?? payload?.Description,
    getRegistry: () => state.albumRegistryIndex,
    setRegistry: (next) => { state.albumRegistryIndex = next; },
    saveRegistry: saveAlbumRegistryMap,
    listDefinitions: listAlbumDefinitions,
    getUsageCounts: getAlbumUsageCounts,
    sortEntries: (values) => [...values].sort((a, b) => a.Title.localeCompare(b.Title, "zh-CN")),
    mutateMetadataOnDelete: (item, title) => {
      if (normalizeAlbumTitle(item?.Customization?.Album) !== title) return false;
      item.Customization = {
        ...(item.Customization || {}),
        Album: "",
        MetadataUpdateDate: new Date().toISOString(),
      };
      delete item.Customization.Category;
      return true;
    },
  });
  const locationService = createLocationRegistryService({
    ...commonRegistryOptions,
    dataFileName: DATA_FILE_NAMES.locations,
    getRegistry: () => state.locationRegistryIndex,
    setRegistry: (next) => { state.locationRegistryIndex = next; },
    normalizeName: normalizeLocationName,
    normalizeField: normalizeLocationField,
    validateParent: validateLocationParent,
    getDepth: getLocationDepth,
    buildPath: buildLocationPath,
    listDefinitions: listLocationDefinitions,
    saveRegistry: saveLocationRegistryMap,
  });
  const metadataEditService = createMetadataEditService({
    getMetadata: () => state.metadataIndex,
    requireOpenLibrary,
    normalizeRegisteredTags,
    normalizeRegisteredAlbum,
    normalizeRegisteredPeople,
    normalizeRegisteredLocation,
    normalizeLocationObject,
    saveMetadata: saveMetadataMap,
    enrichItem,
    appendLog,
  });
  return { albumService, locationService, metadataEditService, personService, tagService };
}

/**
 * Register all IPC endpoints used by renderer.
 * Channels are intentionally explicit to keep the API surface narrow and auditable.
 */
function registerIpcHandlers() {
  const runtime = {
    get config() { return config; },
    set config(next) { config = next; },
    get mainWindow() { return state.mainWindow; },
    get quickScanState() { return state.quickScanState; },
    get activeLibrary() { return state.activeLibrary; },
    get activeWorker() { return state.activeWorker; },
    get maintenanceState() { return state.maintenanceState; },
    get metadataIndex() { return state.metadataIndex; },
  };
  registerMainIpcHandlers({
    runtime,
    configPath: CONFIG_PATH,
    normalizeMediaConfig,
    applyConfigPatch,
    persistConfig,
    toSerializable,
    appendLog,
    getLibraryState,
    checkMediaTools,
    inspectLibraryDirectory,
    openLibrary,
    resolveLibraryPaths,
    runOperationWorker,
    inspectLibraryLock,
    closeLibrary,
    requireOpenLibrary,
    prepareLibraryWrite,
    normalizeLibraryName,
    writeLibraryManifest,
    emitLibraryState,
    runMaintenanceOperation,
    queryGallery,
    resolveIndexedMediaPath,
    warmupThumbnailCache,
    services: createDomainServices(),
  });
}

/**
 * App bootstrap sequence:
 * 1) load app-level config and last-library state
 * 2) validate media tools without opening a library
 * 3) create BrowserWindow and bind diagnostics
 * 4) load the renderer entry; renderer may then request last-library open
 */
async function bootstrap() {
  const configResult = loadConfig(CONFIG_PATH, DEFAULT_CONFIG, normalizeMediaConfig);
  config = configResult.config;
  if (configResult.warning) appendLog(configResult.warning);
  await loadAppState();
  await checkMediaTools();

  state.mainWindow = await createMainWindow({
    rendererIndexPath: RENDERER_INDEX_PATH,
    preloadPath: path.join(__dirname, "preload.js"),
    appendLog,
    onCreated: (window) => { state.mainWindow = window; },
    isMaintenanceRunning: () => state.maintenanceState.running,
    getInitializationWorker: () => state.activeWorker && state.activeWorkerOperation === "initialize" ? state.activeWorker : null,
    cancelInitializationAndClose: (worker) => {
      state.pendingAppClose = true;
      worker.send({ type: "cancel" });
    },
  });
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
  if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
  if (state.mainWindow.isMinimized()) state.mainWindow.restore();
  state.mainWindow.show();
  state.mainWindow.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (state.activeLibrary) {
    const closing = state.activeLibrary;
    state.activeLibrary = null;
    try {
      const current = JSON.parse(fs.readFileSync(closing.paths.lockFile, "utf8"));
      if (current?.SessionId === closing.sessionId) fs.rmSync(closing.paths.lockFile, { force: true });
    } catch {
      // Best-effort synchronous cleanup during application shutdown.
    }
  }
});
