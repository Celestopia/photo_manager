/**
 * Thumbnail cache warmup script.
 *
 * Usage:
 * - npm run build-thumbnails
 *
 * It loads existing metadata records and generates missing thumbnails into
 * the configured cache directory using SHA256 file naming.
 */
const { DATA_FILE_NAMES, resolveConfig, absFromConfig, dataFilePath, loadExisting } = require("./common");
const { normalizeThumbnailConfig, ensureThumbnailsForItems } = require("./thumbnail-cache");

async function run() {
  const config = resolveConfig();
  const metadataFile = dataFilePath(config, DATA_FILE_NAMES.metadata);
  const workspaceRoot = absFromConfig(config, config.workspaceRoot);
  const thumbnailConfig = normalizeThumbnailConfig(config.thumbnail);
  const thumbnailDir = absFromConfig(config, thumbnailConfig.dir);

  const existing = await loadExisting(metadataFile);
  const imageItems = [...existing.values()].filter((item) => item?.FileSystem?.FileType === "image");
  const stats = await ensureThumbnailsForItems(imageItems, {
    workspaceRoot,
    cacheDir: thumbnailDir,
    options: thumbnailConfig,
    maxConcurrency: thumbnailConfig.maxConcurrency,
    logger: (message) => console.warn(message),
  });

  console.log(
    `Thumbnail cache warmup complete: total=${stats.total}, generated=${stats.generated}, skipped=${stats.skipped}, failed=${stats.failed}`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
