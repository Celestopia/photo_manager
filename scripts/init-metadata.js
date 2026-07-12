/**
 * Full initialization script.
 *
 * Behavior:
 * - Scan workspace recursively.
 * - Build metadata for supported files.
 * - Rewrite metadata JSONL from scratch.
 */
const path = require("node:path");
const { APP_ROOT, DATA_FILE_NAMES, resolveConfig, absFromConfig, dataFilePath, ensureDataDir, walkFiles, buildMetadata, writeAll, extensionType } = require("./common");
const { normalizeThumbnailConfig, ensureThumbnailsForItems } = require("./thumbnail-cache");
const { validateMediaTools } = require("./media-tools");

/**

 * Initialize metadata from scratch for all supported files in workspace.

 * Image and video records share the same JSONL metadata file.

 */

async function run() {
  // Resolve runtime paths from config.
  const config = resolveConfig();
  const root = absFromConfig(config, config.workspaceRoot);
  await ensureDataDir(config);
  const metadataFile = dataFilePath(config, DATA_FILE_NAMES.metadata);
  const thumbnailConfig = normalizeThumbnailConfig(config.thumbnail);
  const thumbnailDir = absFromConfig(config, thumbnailConfig.dir);
  await validateMediaTools(APP_ROOT, config.media);

  const files = await walkFiles(root);
  const mediaFiles = files.filter((f) => extensionType(path.extname(f)));

  const entries = [];
  for (const file of mediaFiles) {
    try {
      const data = await buildMetadata(file, root, { mediaConfig: config.media });
      if (data) entries.push(data);
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
    mediaConfig: config.media,
    logger: (message) => console.warn(message),
  });
  const imageCount = entries.filter((item) => item.FileSystem.FileType === "image").length;
  const videoCount = entries.filter((item) => item.FileSystem.FileType === "video").length;
  const probeFailures = entries.filter((item) => item.Video?.ProbeStatus === "failed").length;
  console.log(`Initialized metadata: total=${entries.length}, images=${imageCount}, videos=${videoCount}, probeFailed=${probeFailures}`);
  console.log(
    `Thumbnail cache: generated=${thumbnailStats.generated}, skipped=${thumbnailStats.skipped}, failed=${thumbnailStats.failed}`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
