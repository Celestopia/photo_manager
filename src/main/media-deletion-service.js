const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { assertUuidArray } = require("../shared/identity-schema.js");
const { assertExactObjectKeys } = require("../shared/object-schema.js");

function createMediaDeletionService(options) {
  const {
    getMetadata,
    getMediaPathIndex,
    requireOpenLibrary,
    resolveIndexedMediaPath,
    prepareLibraryWrite,
    commitDeletion,
    thumbnailAbsolutePath,
    clearThumbnailStatusCache,
    touchLibraryManifest,
    emitLibraryState,
    stopChat,
    appendLog,
  } = options;

  async function deleteMedia(payload) {
    try {
      requireOpenLibrary({ writable: true });
      assertExactObjectKeys(payload, ["mediaIds"], "Media deletion payload");
      assertUuidArray(payload.mediaIds, "mediaIds");
      if (!payload.mediaIds.length) throw new Error("Select at least one media item to delete");

      const metadata = getMetadata();
      const targets = payload.mediaIds.map((mediaId) => {
        const resolved = resolveIndexedMediaPath(mediaId);
        if (!fs.statSync(resolved.absolutePath).isFile()) throw new Error(`Media path is not a file: ${resolved.item.FilePath}`);
        return { MediaId: mediaId, item: resolved.item, absolutePath: resolved.absolutePath };
      });
      const targetIds = new Set(payload.mediaIds);
      const remainingEntries = [...metadata.values()].filter((item) => !targetIds.has(item.MediaId));

      await stopChat();
      await prepareLibraryWrite("media-delete", { immediate: true });
      const library = requireOpenLibrary({ writable: true });
      const transaction = await commitDeletion(library.paths, targets, remainingEntries, {
        reason: "media-delete",
        onCleanupError: (error) => appendLog(`media-delete cleanup pending: ${error.message}`),
      });

      const mediaPathIndex = getMediaPathIndex();
      for (const target of targets) {
        metadata.delete(target.MediaId);
        mediaPathIndex.delete(target.item.FilePath);
      }
      await touchLibraryManifest();

      const remainingHashes = new Set(remainingEntries.map((item) => item.SHA256Hash).filter(Boolean));
      for (const hash of new Set(targets.map((target) => target.item.SHA256Hash).filter(Boolean))) {
        if (remainingHashes.has(hash)) continue;
        await fsp.rm(thumbnailAbsolutePath(library.paths.thumbnailDir, hash), { force: true })
          .catch((error) => appendLog(`thumbnail cleanup failed hash=${hash}: ${error.message}`));
      }
      clearThumbnailStatusCache();
      emitLibraryState();
      appendLog(`media-delete committed count=${targets.length} cleanupPending=${transaction.cleanupPending}`);
      return {
        ok: true,
        deletedMediaIds: [...payload.mediaIds],
        deletedCount: targets.length,
        cleanupPending: Boolean(transaction.cleanupPending),
      };
    } catch (error) {
      appendLog(`media-delete failed: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  return { deleteMedia };
}

module.exports = { createMediaDeletionService };
