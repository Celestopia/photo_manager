const path = require("node:path");

/**
 * Add renderer-only paths, thumbnail state, and grouping data to media records.
 * Thumbnail filesystem checks are cached for the active library and explicitly
 * invalidated by the lifecycle owner after cache-changing maintenance tasks.
 */
function createGalleryItemEnricher({
  getLibrary,
  assertPathInsideLibrary,
  thumbnailAbsolutePath,
  listThumbnailFiles,
  now = Date.now,
  getSourceToken,
}) {
  let thumbnailDirectory = "";
  let thumbnailFileNames = null;
  let thumbnailCacheVersion = 0;

  function loadThumbnailStatusCache(directory) {
    thumbnailDirectory = directory;
    thumbnailFileNames = new Set();
    thumbnailCacheVersion = Math.max(Number(now()) || 0, thumbnailCacheVersion + 1);
    try {
      for (const entry of listThumbnailFiles(directory)) {
        if (typeof entry === "string") thumbnailFileNames.add(entry);
        else if (entry?.isFile?.()) thumbnailFileNames.add(entry.name);
      }
    } catch {
      // A missing or unreadable cache directory is equivalent to no thumbnails.
    }
  }

  function getThumbnailStatus(thumbnailPath, directory) {
    if (!thumbnailPath) return { available: false, version: 0 };
    if (!thumbnailFileNames || thumbnailDirectory !== directory) loadThumbnailStatusCache(directory);
    const available = thumbnailFileNames.has(path.basename(thumbnailPath));
    return { available, version: available ? thumbnailCacheVersion : 0 };
  }

  function enrichItem(item) {
    const library = getLibrary();
    const absolutePath = assertPathInsideLibrary(
      library.paths,
      path.join(library.paths.root, item.FilePath),
    );
    const thumbnailPath = item?.SHA256Hash
      ? thumbnailAbsolutePath(library.paths.thumbnailDir, item.SHA256Hash)
      : "";
    const thumbnailStatus = getThumbnailStatus(thumbnailPath, library.paths.thumbnailDir);
    return {
      ...item,
      ...(getSourceToken ? { __sourceToken: getSourceToken(item) } : {}),
      __absolutePath: absolutePath,
      __thumbnailPath: thumbnailPath,
      __thumbnailAvailable: thumbnailStatus.available,
      __thumbnailVersion: thumbnailStatus.version,
      __groupDate: (item?.FileSystem?.ShootingTimeString || "").slice(0, 10) || "Unknown",
    };
  }

  function clearThumbnailStatusCache() {
    thumbnailDirectory = "";
    thumbnailFileNames = null;
  }

  return { enrichItem, clearThumbnailStatusCache };
}

module.exports = { createGalleryItemEnricher };
