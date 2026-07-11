/**
 * Incremental metadata sync script.
 *
 * Strategy:
 * 1) Re-scan workspace and rebuild latest file metadata.
 * 2) Preserve Customization/Location from existing metadata whenever possible.
 * 3) Use SHA256 to carry Customization across file moves/renames.
 * 4) Rewrite JSONL as the current truth snapshot.
 */
const path = require("node:path");
const { DATA_FILE_NAMES, resolveConfig, absFromConfig, dataFilePath, ensureDataDir, walkFiles, buildMetadata, loadExisting, writeAll, extensionType } = require("./common");
const { normalizeThumbnailConfig, ensureThumbnailsForItems } = require("./thumbnail-cache");

/**

 * Incrementally rebuild metadata while preserving user-authored fields.

 * Supports move/rename continuity by matching records through SHA256 hash.

 */

async function run() {
  const config = resolveConfig();
  const root = absFromConfig(config, config.workspaceRoot);
  await ensureDataDir(config);
  const metadataFile = dataFilePath(config, DATA_FILE_NAMES.metadata);
  const thumbnailConfig = normalizeThumbnailConfig(config.thumbnail);
  const thumbnailDir = absFromConfig(config, thumbnailConfig.dir);

  const existing = await loadExisting(metadataFile);
  const files = await walkFiles(root);
  const imageFiles = files.filter((f) => extensionType(path.extname(f)) === "image");

  const byHash = new Map();
  // Secondary index used to detect moved files with same content hash.
  for (const item of existing.values()) byHash.set(item.SHA256Hash, item);

  const next = new Map();

  for (const absFile of imageFiles) {
    try {
      const built = await buildMetadata(absFile, root);
      if (!built) continue;

      const oldDirect = existing.get(built.FilePath);
      // Prefer direct FilePath hit, otherwise fallback to hash-based move tracking.
      if (oldDirect) {
        built.Customization = oldDirect.Customization || built.Customization;
        built.Location = { ...(built.Location || {}), ...(oldDirect.Location || {}) };
      } else if (byHash.has(built.SHA256Hash)) {
        const oldByHash = byHash.get(built.SHA256Hash);
        built.Customization = oldByHash.Customization || built.Customization;
        built.Location = { ...(built.Location || {}), ...(oldByHash.Location || {}) };
      }
      if (built.Customization && Object.prototype.hasOwnProperty.call(built.Customization, "Category")) {
        delete built.Customization.Category;
      }

      next.set(built.FilePath, built);
    } catch (error) {
      console.error(`Skip file: ${absFile} (${error.message})`);
    }
  }

  const nextEntries = [...next.values()];
  await writeAll(metadataFile, nextEntries);
  const thumbnailStats = await ensureThumbnailsForItems(nextEntries, {
    workspaceRoot: root,
    cacheDir: thumbnailDir,
    options: thumbnailConfig,
    maxConcurrency: thumbnailConfig.maxConcurrency,
    logger: (message) => console.warn(message),
  });
  console.log(`Updated metadata: ${next.size} images`);
  console.log(
    `Thumbnail cache: generated=${thumbnailStats.generated}, skipped=${thumbnailStats.skipped}, failed=${thumbnailStats.failed}`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
