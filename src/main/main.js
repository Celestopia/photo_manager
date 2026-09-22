const { configureMapNetwork } = require("./map-network");
const { groupMediaPathsByHash, countMediaTypes } = require("../../scripts/media-summary");
const { assertMediaTechnicalFields } = require("../shared/media-technical-schema");
/**
 * Electron main-process entry.
 *
 * Responsibilities:
 * 1) Load and normalize runtime configuration.
 * 2) Coordinate isolated library sessions for renderer windows.
 * 3) Route IPC handlers to the session that owns the trusted sender.
 * 4) Create and monitor renderer windows.
 */
const { app, BrowserWindow, ipcMain, protocol, net, shell } = require("electron");
const { SCHEME, registerViewerImageScheme, createViewerImageResources, handleViewerImageRequest } = require("./viewer-image-resources");
registerViewerImageScheme(protocol);
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { fork } = require("node:child_process");
const { loadConfig } = require(path.join(__dirname, "..", "..", "scripts", "application-config.js"));
const {
  resolveApplicationPaths,
  configureElectronStoragePaths,
} = require(path.join(__dirname, "..", "..", "scripts", "application-paths.js"));
const {
  loadApplicationState,
  saveApplicationState,
} = require("./application-state.js");
const {
  createLocationDomain,
  normalizeLocationField,
  normalizeLocationName,
  normalizeLocationObject,
} = require("./location-domain.js");
const { createGalleryQueryService } = require("./gallery-query.js");
const { createGalleryItemEnricher } = require("./gallery-item-enricher.js");
const { createSimpleRegistryService } = require("./simple-registry-service.js");
const { createSimpleRegistryCatalog } = require("./simple-registry-catalog.js");
const { createLocationCatalog } = require("./location-catalog.js");
const { createLocationRegistryService } = require("./location-registry-service.js");
const { createMetadataEditService } = require("./metadata-edit-service.js");
const { createMediaDeletionService } = require("./media-deletion-service.js");
const { registerIpcHandlers: registerMainIpcHandlers } = require("./ipc-handlers.js");
const { createMainWindow } = require("./window-manager.js");
const { createApplicationRuntime } = require("./application-runtime.js");
const { createWindowSessionRouter } = require("./window-session-router.js");
const { registerApplicationWindowLifecycle } = require("./application-window-lifecycle.js");
const { createLibraryClaimRegistry } = require("./library-claim-registry.js");
const { createMutationCoordinator, assertMutationReady } = require("./mutation-coordinator");
const { createMetadataCommit } = require("./chat/metadata-commit");
const { createChatService } = require("./chat/service.js");
const { registerChatIpc } = require("./chat/ipc.js");
const { metadataGroups } = require("./chat/metadata.js");
const { resolveMediaToolPaths } = require("../../scripts/media-tools.js");
const { createUniqueEntityId } = require("../shared/identity-schema.js");
const { validateMediaEntries } = require("../shared/library-data-schema.js");
const {
  thumbnailAbsolutePath,
} = require(path.join(__dirname, "..", "..", "scripts", "thumbnail-cache.js"));
const {
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
  assertPathInsideLibrary,
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
  commitJsonlTransaction,
} = require(path.join(__dirname, "..", "..", "scripts", "library-transaction.js"));
const {
  commitMediaDeletion,
} = require(path.join(__dirname, "..", "..", "scripts", "media-deletion-transaction.js"));
const { recoverLibraryTransactions } = require("../../scripts/library-recovery");
const {
  walkFiles,
  extensionType,
} = require(path.join(__dirname, "..", "..", "scripts", "common.js"));
const { PROGRAM_RESOURCE_ROOT_ENV } = require(path.join(__dirname, "..", "..", "scripts", "program-paths.js"));

const APP_CODE_ROOT = path.resolve(__dirname, "..", "..");
const PROGRAM_RESOURCE_ROOT = app.isPackaged ? process.resourcesPath : APP_CODE_ROOT;
const APPLICATION_PATHS = resolveApplicationPaths();
configureElectronStoragePaths(app, APPLICATION_PATHS);
const RENDERER_INDEX_PATH = path.join(APP_CODE_ROOT, "dist", "renderer", "index.html");

const sessionRouter = createWindowSessionRouter();
const state = sessionRouter.createProxy((session) => session.runtime, "window runtime");
const chat = sessionRouter.createProxy((session) => session.chat, "window chat service");
let config = null;
let appState = { lastLibraryPath: "" };
let lastLibraryName = "";
let appStateWriteQueue = Promise.resolve();
let mediaToolsState = { available: false, error: "Media tools have not been checked", versions: null };
const libraryClaims = createLibraryClaimRegistry();
const applicationStartedAt = new Date().toISOString();
const UNASSIGNED_FILTER = "__UNASSIGNED__";

function createRuntimeEntityId() {
  return createUniqueEntityId((id) => (
    state.metadataIndex.has(id)
    || state.tagRegistryIndex.has(id)
    || state.albumRegistryIndex.has(id)
    || state.personRegistryIndex.has(id)
    || state.locationRegistryIndex.has(id)
  ));
}

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

function claimLibraryIdentity(manifest, root) {
  const session = sessionRouter.current();
  libraryClaims.claim(session, manifest, root);
}

function releaseLibraryIdentity(session = sessionRouter.current()) {
  libraryClaims.release(session);
}

/**
 * Append one line into date-partitioned log file under configured log directory.
 */
function appendLog(message) {
  try {
    const session = sessionRouter.current({ optional: true });
    const logDir = session?.runtime?.activeLibrary?.paths?.logDir || APPLICATION_PATHS.logsDir;
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

async function loadAppState() {
  appState = await loadApplicationState(APPLICATION_PATHS.stateFile);
  lastLibraryName = "";
  if (!appState.lastLibraryPath) return;
  try {
    const paths = resolveLibraryPaths(appState.lastLibraryPath);
    lastLibraryName = (await readLibraryManifest(paths)).name;
  } catch (error) {
    appendLog(`last-library manifest read failed: ${error.message}`);
  }
}

async function saveAppState() {
  const snapshot = { ...appState };
  const write = appStateWriteQueue.then(() => saveApplicationState(APPLICATION_PATHS.stateFile, snapshot));
  appStateWriteQueue = write.catch(() => {});
  await write;
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
  if (writable) assertMutationReady(state.activeLibrary);
  return state.activeLibrary;
}

/**
 * Read metadata JSONL into an in-memory Map keyed by MediaId.
 * Strict parsing deliberately rejects malformed or duplicate records so an
 * inconsistent library never opens as if it were healthy.
 */
async function loadMetadataIndex() {
  state.metadataIndex.clear();
  const metadataFile = resolveDataFile(DATA_FILE_NAMES.metadata);
  const entries = await readJsonlStrict(metadataFile, {
    label: DATA_FILE_NAMES.metadata,
    keyOf: (item) => item?.MediaId,
  });
  validateMediaEntries(entries, {
    tags: state.tagRegistryIndex,
    albums: state.albumRegistryIndex,
    people: state.personRegistryIndex,
    locations: state.locationRegistryIndex,
  });
  for (const item of entries) {
    assertPathInsideLibrary(state.activeLibrary.paths, path.join(state.activeLibrary.paths.root, item.FilePath));
    assertMediaTechnicalFields(item);
    state.metadataIndex.set(item.MediaId, item);
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
  assertMutationReady(library);
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
  idKey: "TagId",
  definitionKey: "Text",
  invalidKeyLabel: "tag key",
  dataFileName: DATA_FILE_NAMES.tags,
  backupReason: "tag-registry-write",
  normalize: normalizeTagText,
  extractReferences: (item) => Array.isArray(item?.Customization?.TagIds) ? item.Customization.TagIds : [],
  getRegistry: () => state.tagRegistryIndex,
  getMetadata: () => state.metadataIndex,
  resolveDataFile,
  prepareLibraryWrite,
  touchLibraryManifest,
  readJsonlStrict,
  writeJsonlAtomic,
});
const personCatalog = createSimpleRegistryCatalog({
  idKey: "PersonId",
  definitionKey: "Name",
  invalidKeyLabel: "person key",
  dataFileName: DATA_FILE_NAMES.people,
  backupReason: "person-registry-write",
  normalize: normalizePersonName,
  extractReferences: (item) => Array.isArray(item?.Customization?.PersonIds) ? item.Customization.PersonIds : [],
  getRegistry: () => state.personRegistryIndex,
  getMetadata: () => state.metadataIndex,
  resolveDataFile,
  prepareLibraryWrite,
  touchLibraryManifest,
  readJsonlStrict,
  writeJsonlAtomic,
});
const albumCatalog = createSimpleRegistryCatalog({
  idKey: "AlbumId",
  definitionKey: "Title",
  invalidKeyLabel: "album key",
  dataFileName: DATA_FILE_NAMES.albums,
  backupReason: "album-registry-write",
  normalize: normalizeAlbumTitle,
  normalizeLoadedDescription: normalizeAlbumTitle,
  extractReferences: (item) => {
    const albumId = item?.Customization?.AlbumId;
    return albumId ? [albumId] : [];
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
  getLocationIdsForRegion,
  validateLocationParent,
} = createLocationDomain(() => state.locationRegistryIndex);
const locationCatalog = createLocationCatalog({
  dataFileName: DATA_FILE_NAMES.locations,
  getRegistry: () => state.locationRegistryIndex,
  getMetadata: () => state.metadataIndex,
  normalizeField: normalizeLocationField,
  normalizeObject: normalizeLocationObject,
  getChildrenMap: getLocationChildrenMap,
  getDepth: getLocationDepth,
  buildPath: buildLocationPath,
  resolveDataFile,
  prepareLibraryWrite,
  touchLibraryManifest,
  readJsonlStrict,
  writeJsonlAtomic,
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
const listLocationDefinitions = locationCatalog.listDefinitions;
const saveLocationRegistryMap = locationCatalog.save;
const loadLocationRegistryIndex = locationCatalog.load;
const normalizeRegisteredLocation = locationCatalog.normalizeRegistered;

function normalizeRegisteredTags(rawTags) {
  const validation = tagCatalog.validateMany(rawTags);
  return { tagIds: validation.values, unknown: validation.unknown };
}

function normalizeRegisteredPeople(rawPeople) {
  const validation = personCatalog.validateMany(rawPeople);
  return { personIds: validation.values, unknown: validation.unknown };
}

function normalizeRegisteredAlbum(rawAlbum) {
  const validation = albumCatalog.validateOne(rawAlbum);
  return { albumId: validation.value, unknown: validation.unknown };
}

const { execute: executeGalleryQuery, groupByDate } = createGalleryQueryService({
  getLocationDescendants,
  getLocationIdsForRegion,
  unassignedFilter: UNASSIGNED_FILTER,
});
const { enrichItem, clearThumbnailStatusCache } = createGalleryItemEnricher({
  getLibrary: requireOpenLibrary,
  assertPathInsideLibrary,
  thumbnailAbsolutePath,
  listThumbnailFiles: (directory) => fs.readdirSync(directory, { withFileTypes: true }),
  viewerImageUrl: item => sessionRouter.current().viewerImages.urlFor(item),
});

function resolveIndexedMediaPath(rawMediaId) {
  const mediaId = String(rawMediaId || "").trim();
  const item = state.metadataIndex.get(mediaId);
  if (!item) throw new Error("Media record not found");
  const library = requireOpenLibrary();
  const absolutePath = assertPathInsideLibrary(library.paths, path.join(library.paths.root, item.FilePath));
  if (!fs.existsSync(absolutePath)) throw new Error("Media file not found");
  return { item, absolutePath };
}

function createSessionChat(session) {
  return createChatService({
    getLibrary: requireOpenLibrary,
    resolveMedia: resolveIndexedMediaPath,
    getMetadata: (mediaId, groups) => metadataGroups(resolveIndexedMediaPath(mediaId).item, groups, {
      tags: state.tagRegistryIndex, people: state.personRegistryIndex,
      locations: state.locationRegistryIndex, locationPath: buildLocationPath,
    }),
    tags: () => [...state.tagRegistryIndex.values()],
    mutate: session.mutate,
    commitMetadata: createMetadataCommit({getLibrary:requireOpenLibrary,getIndex:()=>state.metadataIndex,getTags:()=>state.tagRegistryIndex,
      prepareWrite:prepareLibraryWrite,metadataFile:()=>resolveDataFile(DATA_FILE_NAMES.metadata),enrich:enrichItem,touchManifest:touchLibraryManifest}),
    configFile: APPLICATION_PATHS.chatProviderFile,
    getMediaToolPaths: () => resolveMediaToolPaths(PROGRAM_RESOURCE_ROOT, config.media),
    searchConfigFile: APPLICATION_PATHS.searchProviderFile,
    emit: (payload) => {
      const window = session.runtime.mainWindow;
      if (window && !window.isDestroyed()) window.webContents.send("chat:event", payload);
    },
  });
}

function broadcastProviderConfigurationChange(sourceWindow) {
  for (const session of sessionRouter.sessions()) {
    const window = session.runtime.mainWindow;
    if (!window || window === sourceWindow || window.isDestroyed()) continue;
    window.webContents.send("chat:event", {
      type: "provider-configuration-changed",
      text: "Provider settings changed in another window. Reopen settings before editing them.",
    });
  }
}

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
  const result = await commitJsonlTransaction(library.paths, changes, { reason });
  if (result.cleanupPending) appendLog(`Transaction committed; temporary cleanup pending: ${result.cleanupError}`);
  await touchLibraryManifest();
}

function clearLibraryIndexes() {
  clearThumbnailStatusCache();
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
  const counts = countMediaTypes(state.metadataIndex.values());
  return {
    state: state.activeLibrary?.state || "closed",
    active: state.activeLibrary ? {
      root: state.activeLibrary.paths.root,
      name: state.activeLibrary.manifest.name,
      libraryId: state.activeLibrary.manifest.libraryId,
      createdAt: state.activeLibrary.manifest.createdAt,
      updatedAt: state.activeLibrary.manifest.updatedAt,
      mediaCount: state.metadataIndex.size,
      imageCount: counts.images,
      videoCount: counts.videos,
    } : null,
    lastLibraryPath: appState.lastLibraryPath,
    lastLibraryName: state.activeLibrary?.manifest?.name || lastLibraryName,
    mediaTools: mediaToolsState,
    maintenance: state.maintenanceState,
    ...extra,
  };
}

async function checkMediaTools() {
  try {
    const tools = await validateMediaTools(PROGRAM_RESOURCE_ROOT, config.media);
    mediaToolsState = { available: true, error: "", versions: tools.versions };
    appendLog(`media-tools ${tools.versions.ffmpeg}; ${tools.versions.ffprobe}`);
  } catch (error) {
    const reason = sanitizeMediaError(error, error?.path || "");
    mediaToolsState = { available: false, error: reason, versions: null };
    appendLog(`media-tools validation failed: ${reason}`);
  }
  for (const session of sessionRouter.sessions()) {
    sessionRouter.run(session, () => emitLibraryState());
  }
  return mediaToolsState;
}

async function loadAllLibraryIndexes() {
  clearThumbnailStatusCache();
  await loadTagRegistryIndex();
  await loadAlbumRegistryIndex();
  await loadPersonRegistryIndex();
  await loadLocationRegistryIndex();
  await loadMetadataIndex();
  const hashes = groupMediaPathsByHash(state.metadataIndex.values(), { skipMissing: true });
  for (const [hash, filePaths] of hashes) {
    if (filePaths.length > 1) appendLog(`duplicate-sha256 hash=${hash} files=${filePaths.sort().join("|")}`);
  }
}

async function openLibrary(rawRoot, options = {}) {
  if (!mediaToolsState.available) {
    const error = new Error(`FFmpeg media tools are unavailable: ${mediaToolsState.error}`);
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
  if (state.openingLibrary) {
    const error = new Error("A library is already being opened in this window");
    error.code = "LIBRARY_OPEN_RUNNING";
    throw error;
  }
  state.openingLibrary = true;
  try {
    if (state.activeLibrary) await closeLibrary();
    const paths = resolveLibraryPaths(rawRoot);
    const session = sessionRouter.current();
    emitLibraryState({ state: "opening", openingPath: paths.root });
    let lock = null;
    let identityClaimed = false;
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
      const identityManifest = await readLibraryManifest(paths);
      claimLibraryIdentity(identityManifest, paths.root);
      identityClaimed = true;
      const manifest = await validateExistingLibrary(paths, {
        onProgress: (progress) => state.mainWindow?.webContents.send("library:progress", toSerializable(progress)),
      });
      lock = await acquireLibraryLock(paths, manifest, {
        force: Boolean(options.force),
        applicationStartedAt,
      });
      state.activeLibrary = { state: "opening", sessionId: lock.SessionId, paths, manifest, lock };
      await recoverLibraryTransactions(paths, appendLog);
      await loadAllLibraryIndexes();
      if (marker?.Status === "committed") await fsp.rm(paths.initializationFile, { force: true });
      state.activeLibrary.state = "open";
      await chat.open().catch(() => appendLog("Chat recovery could not finish; library browsing remains available."));
      appState.lastLibraryPath = paths.root;
      lastLibraryName = state.activeLibrary.manifest.name;
      await saveAppState().catch((error) => appendLog(`app-state write failed: ${error.message}`));
      emitLibraryState();
      return getLibraryState();
    } catch (error) {
      if (lock) await releaseLibraryLock(paths, lock.SessionId).catch(() => {});
      if (identityClaimed) releaseLibraryIdentity(session);
      state.activeLibrary = null;
      clearLibraryIndexes();
      emitLibraryState({ error: error.message });
      throw error;
    }
  } finally {
    state.openingLibrary = false;
  }
}

async function closeLibrary() {
  if (state.maintenanceState.running) {
    const error = new Error("Cannot close the library while maintenance is running");
    error.code = "MAINTENANCE_RUNNING";
    throw error;
  }
  if (!state.activeLibrary) return getLibraryState();
  state.activeLibrary.state = "closing";
  sessionRouter.current().viewerImages.invalidate();
  try { await chat.close(); }
  catch (error) { state.activeLibrary.state = "open"; emitLibraryState(); throw error; }
  emitLibraryState();
  const closing = state.activeLibrary;
  state.activeLibrary = null;
  clearLibraryIndexes();
  await releaseLibraryLock(closing.paths, closing.sessionId).catch((error) => appendLog(`lock-release failed: ${error.message}`));
  releaseLibraryIdentity();
  emitLibraryState();
  return getLibraryState();
}

async function inspectLibraryDirectory(rawRoot) {
  if (!mediaToolsState.available) {
    const error = new Error(`FFmpeg media tools are unavailable: ${mediaToolsState.error}`);
    error.code = "MEDIA_TOOLS_UNAVAILABLE";
    throw error;
  }
  const paths = resolveLibraryPaths(rawRoot);
  const stat = await fsp.stat(paths.root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error("The selected library directory does not exist");
  const linkStat = await fsp.lstat(paths.root);
  if (linkStat.isSymbolicLink()) throw new Error("A symbolic-link directory cannot be used as a library root");
  const parentManager = findParentManagerDirectory(paths.root);
  if (parentManager) throw new Error(`The selected directory is inside another library: ${parentManager}`);
  if (fs.existsSync(paths.managerDir)) {
    if (fs.existsSync(paths.initializationFile)) {
      const marker = JSON.parse(await fsp.readFile(paths.initializationFile, "utf8"));
      if (marker?.Status !== "committed") {
        const lockState = await inspectLibraryLock(paths);
        if (lockState.active) {
          const error = new Error("Another process is initializing this directory; it cannot be opened or cleaned up");
          error.code = "LIBRARY_LOCKED";
          throw error;
        }
        return {
          kind: "failed-initialization",
          root: paths.root,
          marker: {
            ...marker,
            Error: marker?.Error || "The previous library initialization stopped before completion.",
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
  const session = sessionRouter.current();
  if (state.activeWorker) {
    const error = new Error("Another library operation is already running");
    error.code = "MAINTENANCE_RUNNING";
    return Promise.reject(error);
  }
  const workerPath = path.join(APP_CODE_ROOT, "scripts", "maintenance-worker.js");
  const worker = fork(workerPath, [operation, root, JSON.stringify(options)], {
    cwd: PROGRAM_RESOURCE_ROOT,
    windowsHide: true,
    env: {
      ...process.env,
      [PROGRAM_RESOURCE_ROOT_ENV]: PROGRAM_RESOURCE_ROOT,
      PHOTO_MANAGER_LIBRARY_SESSION: operation === "initialize" ? "" : state.activeLibrary?.sessionId || "",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  state.activeWorker = worker;
  state.activeWorkerOperation = operation;
  return new Promise((resolve, reject) => {
    const inSession = (listener) => (...args) => sessionRouter.run(session, () => listener(...args));
    let result = null;
    let failure = null;
    worker.stdout?.on("data", inSession((chunk) => appendOperationLog(operation, root, `worker-${operation} ${String(chunk).trim()}`)));
    worker.stderr?.on("data", inSession((chunk) => appendOperationLog(operation, root, `worker-${operation}-stderr ${String(chunk).trim()}`)));
    worker.on("message", inSession((message) => {
      if (message?.type === "progress" || message?.type === "log") {
        if (message.message) appendOperationLog(operation, root, `worker-${operation} ${message.level || "info"}: ${message.message}`);
        state.mainWindow?.webContents.send(operation === "initialize" ? "library:progress" : "maintenance:progress", toSerializable(message));
      }
      if (message?.type === "result") result = message.result;
      if (message?.type === "failure") failure = message.error;
    }));
    worker.on("error", reject);
    worker.on("exit", inSession((code) => {
      state.activeWorker = null;
      state.activeWorkerOperation = "";
      if (state.pendingWindowClose) {
        state.pendingWindowClose = false;
        setImmediate(() => {
          session.runtime.mainWindow?.destroy();
        });
      }
      if (code === 0 && result) resolve(result);
      else {
        const error = new Error(failure?.message || `${operation} worker exited with code ${code}`);
        error.code = failure?.code || "OPERATION_FAILED";
        reject(error);
      }
    }));
  });
}

async function runMaintenanceOperation(operation, options = {}) {
  const library = requireOpenLibrary({ writable: true });
  state.maintenanceState = { running: true };
  sessionRouter.current().viewerImages.invalidate();
  emitLibraryState();
  try {
    await chat.close();
    const result = await runOperationWorker(operation, library.paths.root, options);
    if (operation === "update") {
      // The worker has released its inherited operation lock, so the main
      // process can leave read-only mode before rebuilding the in-memory indexes.
      state.maintenanceState.running = false;
      await loadAllLibraryIndexes();
    }
    return { ok: true, result };
  } catch (error) {
    appendLog(`maintenance-${operation} failed: ${error.stack || error.message}`);
    return { ok: false, error: error.message, code: error.code };
  } finally {
    if (operation === "update" || operation === "thumbnails") clearThumbnailStatusCache();
    state.maintenanceState.running = false;
    emitLibraryState();
  }
}

function queryGallery(query) {
  requireOpenLibrary();
  const result = executeGalleryQuery(state.metadataIndex.values(), query);
  const items = result.items.map(enrichItem);
  return {
    total: items.length,
    groups: groupByDate(items),
  };
}

function createDomainServices() {
  const commonRegistryOptions = {
    getMetadata: () => state.metadataIndex,
    requireOpenLibrary,
    prepareLibraryWrite,
    saveTransaction: saveRegistryAndMetadataTransaction,
    appendLog,
    createId: createRuntimeEntityId,
  };
  const tagService = createSimpleRegistryService({
    ...commonRegistryOptions,
    kind: "Tag",
    keyLabel: "Tag text",
    idKey: "TagId",
    definitionKey: "Text",
    responseItemKey: "tag",
    responseListKey: "tags",
    dataFileName: DATA_FILE_NAMES.tags,
    descriptionRequired: false,
    normalize: normalizeTagText,
    payloadKey: "text",
    payloadIdKey: "tagId",
    getRegistry: () => state.tagRegistryIndex,
    setRegistry: (next) => { state.tagRegistryIndex = next; },
    saveRegistry: saveTagRegistryMap,
    listDefinitions: listTagDefinitions,
    getUsageCounts: getTagUsageCounts,
    findByLabel: tagCatalog.findByLabel,
    sortEntries: (values) => [...values].sort((a, b) => a.Text.localeCompare(b.Text, "en-US")),
    updateMetadataOnDelete: (item, tagId, now) => {
      const tagIds = Array.isArray(item?.Customization?.TagIds) ? item.Customization.TagIds : [];
      if (!tagIds.includes(tagId)) return null;
      return {
        ...item,
        Customization: {
          ...(item.Customization || {}),
          TagIds: tagIds.filter((id) => id !== tagId),
          MetadataUpdateDate: now,
        },
      };
    },
  });
  const personService = createSimpleRegistryService({
    ...commonRegistryOptions,
    kind: "Person",
    keyLabel: "Person name",
    idKey: "PersonId",
    definitionKey: "Name",
    responseItemKey: "person",
    responseListKey: "people",
    dataFileName: DATA_FILE_NAMES.people,
    descriptionRequired: false,
    normalize: normalizePersonName,
    payloadKey: "name",
    payloadIdKey: "personId",
    getRegistry: () => state.personRegistryIndex,
    setRegistry: (next) => { state.personRegistryIndex = next; },
    saveRegistry: savePersonRegistryMap,
    listDefinitions: listPersonDefinitions,
    getUsageCounts: getPersonUsageCounts,
    findByLabel: personCatalog.findByLabel,
    sortEntries: (values) => [...values].sort((a, b) => a.Name.localeCompare(b.Name, "en-US")),
    updateMetadataOnDelete: (item, personId, now) => {
      const personIds = Array.isArray(item?.Customization?.PersonIds) ? item.Customization.PersonIds : [];
      if (!personIds.includes(personId)) return null;
      return {
        ...item,
        Customization: {
          ...(item.Customization || {}),
          PersonIds: personIds.filter((id) => id !== personId),
          MetadataUpdateDate: now,
        },
      };
    },
  });
  const albumService = createSimpleRegistryService({
    ...commonRegistryOptions,
    kind: "Album",
    keyLabel: "Album title",
    idKey: "AlbumId",
    definitionKey: "Title",
    responseItemKey: "album",
    responseListKey: "albums",
    dataFileName: DATA_FILE_NAMES.albums,
    descriptionRequired: true,
    normalize: normalizeAlbumTitle,
    payloadKey: "title",
    payloadIdKey: "albumId",
    getRegistry: () => state.albumRegistryIndex,
    setRegistry: (next) => { state.albumRegistryIndex = next; },
    saveRegistry: saveAlbumRegistryMap,
    listDefinitions: listAlbumDefinitions,
    getUsageCounts: getAlbumUsageCounts,
    findByLabel: albumCatalog.findByLabel,
    sortEntries: (values) => [...values].sort((a, b) => a.Title.localeCompare(b.Title, "en-US")),
    updateMetadataOnDelete: (item, albumId, now) => {
      if (item?.Customization?.AlbumId !== albumId) return null;
      return {
        ...item,
        Customization: {
          ...(item.Customization || {}),
          AlbumId: null,
          MetadataUpdateDate: now,
        },
      };
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
    findDuplicate: locationCatalog.findDuplicate,
    sortEntries: locationCatalog.sortEntries,
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
  const mediaDeletionService = createMediaDeletionService({
    getMetadata: () => state.metadataIndex,
    requireOpenLibrary,
    resolveIndexedMediaPath,
    prepareLibraryWrite,
    commitDeletion: commitMediaDeletion,
    thumbnailAbsolutePath,
    clearThumbnailStatusCache,
    touchLibraryManifest,
    emitLibraryState,
    stopChat: () => chat.stop(),
    appendLog,
  });
  return { albumService, locationService, mediaDeletionService, metadataEditService, personService, tagService };
}

/**
 * Register all IPC endpoints used by renderer.
 * Channels are intentionally explicit to keep the API surface narrow and auditable.
 */
function registerIpcHandlers() {
  const runWithSession = (event, operation) => sessionRouter.runForEvent(event, operation);
  registerChatIpc({
    chat,
    getWindow: () => state.mainWindow,
    configFile: APPLICATION_PATHS.chatProviderFile,
    runWithSession,
    onConfigurationSaved: broadcastProviderConfigurationChange,
  });
  const runtime = new Proxy({}, {
    get(_target, property) {
      if (property === "config") return config;
      return state[property];
    },
    set(_target, property, value) {
      if (property === "config") config = value;
      else state[property] = value;
      return true;
    },
  });
  const services = Object.fromEntries([
    "albumService",
    "locationService",
    "mediaDeletionService",
    "metadataEditService",
    "personService",
    "tagService",
  ].map((name) => [name, sessionRouter.createProxy((session) => session.services[name], name)]));
  registerMainIpcHandlers({
    runtime,
    mutate: operation => sessionRouter.current().mutate(operation),
    runWithSession,
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
    services,
  });
}

async function closeWindowSession(session) {
  if (session.closePrepared) return;
  if (session.closePromise) return session.closePromise;
  session.closePromise = sessionRouter.run(session, async () => {
    session.acceptingCommands = false;
    session.viewerImages.invalidate();
    if (state.quickScanState) state.quickScanState.cancelled = true;
    await chat.stop().catch((error) => appendLog(`chat stop during window close failed: ${error.message}`));
    await Promise.allSettled([...session.pendingOperations]);
    if (state.activeLibrary) await closeLibrary();
    else await chat.close();
    session.closePrepared = true;
  });
  try {
    await session.closePromise;
  } finally {
    if (!session.closePrepared) session.acceptingCommands = true;
    session.closePromise = null;
  }
}

/** Create one renderer window with a fully isolated library runtime. */
async function createLibraryWindow() {
  const session = {
    runtime: createApplicationRuntime(),
    chat: null,
    services: null,
    closePromise: null,
    closePrepared: false,
    claimedLibraryId: null,
    acceptingCommands: true,
    pendingOperations: new Set(),
    mutate: createMutationCoordinator(),
  };
  session.chat = sessionRouter.run(session, () => createSessionChat(session));
  session.viewerImages = createViewerImageResources({
    getLibrary: () => session.acceptingCommands && !session.runtime.maintenanceState.running ? session.runtime.activeLibrary : null,
    getItem: id => session.runtime.metadataIndex.get(id),
    fetchFile: (url, options) => net.fetch(url, options),
  });
  session.services = sessionRouter.run(session, () => createDomainServices());

  try {
    await sessionRouter.run(session, async () => {
      await createMainWindow({
        rendererIndexPath: RENDERER_INDEX_PATH,
        preloadPath: path.join(__dirname, "preload.js"),
        appendLog: (message) => sessionRouter.run(session, () => appendLog(message)),
        onCreated: (window) => {
          configureMapNetwork(window, { app, shell });
          session.runtime.mainWindow = window;
          sessionRouter.register(session);
          window.on("closed", () => {
            sessionRouter.unregister(session);
            session.runtime.mainWindow = null;
          });
        },
        isMaintenanceRunning: () => session.runtime.maintenanceState.running,
        getInitializationWorker: () => (
          session.runtime.activeWorker && session.runtime.activeWorkerOperation === "initialize"
            ? session.runtime.activeWorker
            : null
        ),
        cancelInitializationAndClose: (worker) => {
          session.runtime.pendingWindowClose = true;
          worker.send({ type: "cancel" });
        },
        prepareWindowClose: () => closeWindowSession(session),
      });
    });
    return session.runtime.mainWindow;
  } catch (error) {
    const window = session.runtime.mainWindow;
    sessionRouter.unregister(session);
    await closeWindowSession(session).catch(() => {});
    window?.destroy();
    session.runtime.mainWindow = null;
    throw error;
  }
}

/** Load shared application state once, then create the first entry window. */
async function initializeApplication() {
  protocol.handle(SCHEME, handleViewerImageRequest);
  const configResult = loadConfig(APPLICATION_PATHS.configFile);
  config = configResult.config;
  if (configResult.warning) appendLog(configResult.warning);
  await loadAppState();
  await checkMediaTools();
  registerIpcHandlers();
  await createLibraryWindow();
}

// Keep one Electron coordinator so Chromium profile data and global settings
// remain single-owner; every later application launch creates another window.
const singleInstanceLock = app.requestSingleInstanceLock();
let applicationReady = null;
if (!singleInstanceLock) {
  app.quit();
} else {
  applicationReady = app.whenReady().then(initializeApplication);
  registerApplicationWindowLifecycle({
    app,
    BrowserWindow,
    applicationReady,
    createWindow: createLibraryWindow,
    appendLog,
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitPrepared = false;
let quitPreparation = null;
app.on("before-quit", (event) => {
  if (quitPrepared || sessionRouter.sessions().length === 0) return;
  event.preventDefault();
  if (quitPreparation) return;
  quitPreparation = Promise.all(sessionRouter.sessions().map((session) => closeWindowSession(session)))
    .then(() => {
      quitPrepared = true;
      for (const session of sessionRouter.sessions()) session.runtime.mainWindow?.close();
      if (BrowserWindow.getAllWindows().length === 0) app.quit();
    })
    .catch((error) => appendLog(`application shutdown blocked: ${error.stack || error.message}`))
    .finally(() => { quitPreparation = null; });
});
