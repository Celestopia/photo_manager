const path = require('node:path');
const { writeJsonlAtomic, writeLibraryManifest } = require('./library-core');
const { createLibraryBackup } = require('./library-backup');
const { commitJsonlTransaction } = require('./library-transaction');
const { assertLibraryReady } = require('./library-recovery');

/** Persistence shared by desktop edits and terminal commands. Caller owns the lock. */
function createLibraryPersistence({ getLibrary, getMetadata, getConfig, appendLog }) {
  async function prepareLibraryWrite(reason, { immediate = false } = {}) {
    const library = getLibrary({ writable: true });
    assertLibraryReady(library.paths);
    await createLibraryBackup(library.paths, {
      kind: immediate ? 'immediate' : 'daily', reason, retentionCount: getConfig().backup.retentionCount,
    });
  }
  async function touchLibraryManifest() {
    const library = getLibrary();
    try {
      library.manifest = await writeLibraryManifest(library.paths, { ...library.manifest, updatedAt: new Date().toISOString() });
    } catch (error) {
      // Metadata is already durable. An advisory timestamp must not undo it.
      appendLog(`library manifest timestamp update failed: ${error.message}`);
    }
  }
  async function saveMetadataMap(options = {}) {
    if (options.backup !== false) await prepareLibraryWrite(options.reason || 'metadata-write', { immediate: Boolean(options.immediate) });
    await writeJsonlAtomic(getLibrary({ writable: true }).paths.metadataFile, getMetadata().values());
    await touchLibraryManifest();
  }
  async function saveRegistryAndMetadataTransaction(fileName, entries, reason, includeMetadata) {
    const library = getLibrary({ writable: true });
    assertLibraryReady(library.paths);
    const changes = [{ filePath: path.join(library.paths.dataDir, fileName), entries }];
    if (includeMetadata) changes.push({ filePath: library.paths.metadataFile, entries: getMetadata().values() });
    const result = await commitJsonlTransaction(library.paths, changes, { reason });
    if (result.cleanupPending) appendLog(`Transaction committed; temporary cleanup pending: ${result.cleanupError}`);
    await touchLibraryManifest();
    return result;
  }
  return { prepareLibraryWrite, touchLibraryManifest, saveMetadataMap, saveRegistryAndMetadataTransaction };
}
module.exports = { createLibraryPersistence };
