const path = require('node:path');
const fs = require('node:fs');
const { readJsonlStrict, DATA_FILE_NAMES, assertPathInsideLibrary } = require('./library-core');
const { validateExistingLibrary } = require('./library-access');
const { acquireLibraryLock, releaseLibraryLock } = require('./library-lock');
const { assertLibraryReady } = require('./library-recovery');
const { validateMediaEntries } = require('../shared/library-data-schema');
const { assertMediaTechnicalFields } = require('../shared/media-technical-schema');
const { createLibraryServices } = require('./library-services');
const { createLibraryPersistence } = require('./library-persistence');

async function loadMetadataIndex(paths, state) {
  const entries = await readJsonlStrict(paths.metadataFile, { label: DATA_FILE_NAMES.metadata, keyOf: item => item?.MediaId });
  validateMediaEntries(entries, { tags: state.tagRegistryIndex, albums: state.albumRegistryIndex,
    people: state.personRegistryIndex, locations: state.locationRegistryIndex });
  for (const item of entries) {
    assertPathInsideLibrary(paths, path.join(paths.root, item.FilePath));
    assertMediaTechnicalFields(item);
  }
  state.metadataIndex.clear();
  for (const item of entries) state.metadataIndex.set(item.MediaId, item);
}

/** A command owns one short-lived session. No Electron, chat, or UI state. */
async function openLibrarySession({ paths, config, appendLog = () => {}, signal }) {
  const manifest = await validateExistingLibrary(paths, { signal });
  const lock = await acquireLibraryLock(paths, manifest);
  const close = () => releaseLibraryLock(paths, lock.SessionId);
  try {
    if (fs.existsSync(paths.initializationFile)) {
      const error = new Error('Library initialization is incomplete; inspect initialization.json before retrying.');
      error.code = 'RECOVERY_REQUIRED';
      throw error;
    }
    assertLibraryReady(paths);
    const state = { activeLibrary: { state: 'open', paths, manifest, lock, sessionId: lock.SessionId },
      metadataIndex: new Map(), tagRegistryIndex: new Map(), albumRegistryIndex: new Map(),
      personRegistryIndex: new Map(), locationRegistryIndex: new Map() };
    const requireOpenLibrary = ({ writable = false } = {}) => {
      if (!state.activeLibrary) throw new Error('Library session is closed');
      if (writable) assertLibraryReady(paths);
      return state.activeLibrary;
    };
    const persistence = createLibraryPersistence({ getLibrary: requireOpenLibrary,
      getMetadata: () => state.metadataIndex, getConfig: () => config, appendLog });
    const backend = createLibraryServices({ state, requireOpenLibrary, appendLog, ...persistence,
      resolveDataFile: name => path.join(paths.dataDir, name) });
    await backend.loadTagRegistryIndex();
    await backend.loadAlbumRegistryIndex();
    await backend.loadPersonRegistryIndex();
    await backend.loadLocationRegistryIndex();
    await loadMetadataIndex(paths, state);
    return { state, backend, ...persistence, close: async () => { await close(); state.activeLibrary = null; } };
  } catch (error) { await close(); throw error; }
}
module.exports = { openLibrarySession, loadMetadataIndex };
