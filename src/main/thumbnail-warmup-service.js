const fsp = require("node:fs/promises");

function createThumbnailWarmupService(options) {
  const {
    state,
    getConfig,
    normalizeThumbnailConfig,
    ensureThumbnailsForItems,
    buildThumbnailManifest,
    thumbnailManifestMatches,
    writeTextAtomic,
    appendLog,
  } = options;

  async function warmup() {
    if (state.thumbnailWarmupStarted || state.maintenanceState.running || !state.activeLibrary) return;
    state.thumbnailWarmupStarted = true;
    const sessionId = state.activeLibrary.sessionId;
    const token = { sessionId, cancelled: false };
    state.thumbnailWarmupToken = token;
    const config = getConfig();
    const thumbnailConfig = normalizeThumbnailConfig(config.thumbnail);
    const workspaceRoot = state.activeLibrary.paths.root;
    const thumbnailDir = state.activeLibrary.paths.thumbnailDir;
    const mediaItems = [...state.metadataIndex.values()].filter((item) => ["image", "video"].includes(item?.FileSystem?.FileType));
    if (!mediaItems.length) {
      state.thumbnailWarmupToken = null;
      state.thumbnailWarmupStarted = false;
      return;
    }

    const expectedManifest = buildThumbnailManifest(thumbnailConfig);
    let storedManifest = null;
    try {
      storedManifest = JSON.parse(await fsp.readFile(state.activeLibrary.paths.thumbnailManifestFile, "utf8"));
    } catch {
      storedManifest = null;
    }
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
          if (token.cancelled || !state.activeLibrary || state.activeLibrary.sessionId !== sessionId || !state.mainWindow || state.mainWindow.isDestroyed()) return;
          state.mainWindow.webContents.send("thumbnail:ready", {
            filePath: item.FilePath,
            hash: item.SHA256Hash,
            thumbnailPath,
            thumbnailAvailable: true,
          });
        },
        isCancelled: () => token.cancelled || state.activeLibrary?.sessionId !== sessionId,
      });
      appendLog(`thumbnail-warmup total=${stats.total} generated=${stats.generated} skipped=${stats.skipped} failed=${stats.failed}`);
      if (stats.failed === 0 && state.activeLibrary?.sessionId === sessionId) {
        await writeTextAtomic(state.activeLibrary.paths.thumbnailManifestFile, `${JSON.stringify(expectedManifest, null, 2)}\n`);
      }
    } finally {
      if (state.thumbnailWarmupToken === token) {
        state.thumbnailWarmupToken = null;
        state.thumbnailWarmupStarted = false;
      }
    }
  }

  return { warmup };
}

module.exports = { createThumbnailWarmupService };
