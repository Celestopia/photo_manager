/**
 * Full initialization script.
 *
 * Behavior:
 * - Scan workspace recursively.
 * - Build metadata for supported files.
 * - Keep image records in v1.
 * - Rewrite metadata JSONL from scratch.
 */
const path = require("node:path");
const { DATA_FILE_NAMES, resolveConfig, absFromConfig, dataFilePath, ensureDataDir, walkFiles, buildMetadata, writeAll, extensionType } = require("./common");
const { normalizeThumbnailConfig, ensureThumbnailsForItems } = require("./thumbnail-cache");

/**

 * Initialize metadata from scratch for all supported files in workspace.

 * Current UI consumes image records, so non-image items are skipped.

 */

async function run() {
  // Resolve runtime paths from config.
  const config = resolveConfig();
  const root = absFromConfig(config, config.workspaceRoot);
  await ensureDataDir(config);
  const metadataFile = dataFilePath(config, DATA_FILE_NAMES.metadata);
  const thumbnailConfig = normalizeThumbnailConfig(config.thumbnail);
  const thumbnailDir = absFromConfig(config, thumbnailConfig.dir);

  const files = await walkFiles(root);
  // Keep only recognized media extensions, then filter to image metadata below.
  const imageOrVideo = files.filter((f) => extensionType(path.extname(f)));

  const entries = [];
  for (const file of imageOrVideo) {
    try {
      const data = await buildMetadata(file, root);
      // v1 UI only consumes image records.
      if (data && data.FileSystem.FileType === "image") entries.push(data);
    } catch (error) {
      console.error(`Skip file: ${file} (${error.message})`);
    }
  }

  await writeAll(metadataFile, entries);
  const thumbnailStats = await ensureThumbnailsForItems(entries, {
    workspaceRoot: root,
    cacheDir: thumbnailDir,
    options: thumbnailConfig,
    maxConcurrency: thumbnailConfig.maxConcurrency,
    logger: (message) => console.warn(message),
  });
  console.log(`Initialized metadata: ${entries.length} images`);
  console.log(
    `Thumbnail cache: generated=${thumbnailStats.generated}, skipped=${thumbnailStats.skipped}, failed=${thumbnailStats.failed}`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
