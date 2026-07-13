/** Generate missing, stale, or all thumbnails for one explicit library. */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const {
  APP_ROOT,
  resolveConfig,
  loadExisting,
} = require("./common");
const { normalizeThumbnailConfig, ensureThumbnailsForItems } = require("./thumbnail-cache");
const { validateMediaTools } = require("./media-tools");
const { parseLibraryArgument, writeTextAtomic } = require("./library-core");
const { validateExistingLibrary, authorizeLibraryOperation, validateMetadataPaths } = require("./library-access");
const { createOperationReporter } = require("./operation-progress");
const { readTransactionJournal } = require("./library-transaction");

const THUMBNAIL_GENERATOR_VERSION = 1;

function buildThumbnailManifest(config) {
  return {
    Size: config.size,
    WebpQuality: config.webpQuality,
    ExtremeAspectRatio: config.extremeAspectRatio,
    GeneratorVersion: THUMBNAIL_GENERATOR_VERSION,
  };
}

function thumbnailManifestMatches(current, expected) {
  return Boolean(current && Object.keys(expected).every((key) => current[key] === expected[key]));
}

async function run(options = {}) {
  const config = options.config || resolveConfig();
  const paths = options.paths || parseLibraryArgument();
  const { emit, logger, warnings, errors } = createOperationReporter({ ...options, logger: options.logger || console });
  const manifest = await validateExistingLibrary(paths, { onProgress: (progress) => emit(progress) });
  const authorization = await authorizeLibraryOperation(paths, manifest, options);
  try {
    if (await readTransactionJournal(paths)) throw new Error("A pending library transaction must be recovered by opening the library before thumbnail generation");
    await validateMediaTools(APP_ROOT, config.media);
    const thumbnailConfig = normalizeThumbnailConfig(config.thumbnail);
    const expectedManifest = buildThumbnailManifest(thumbnailConfig);
    let currentManifest = null;
    if (fs.existsSync(paths.thumbnailManifestFile)) {
      try { currentManifest = JSON.parse(await fsp.readFile(paths.thumbnailManifestFile, "utf8")); } catch { currentManifest = null; }
    }
    const force = options.force ?? (process.argv.includes("--force") || !thumbnailManifestMatches(currentManifest, expectedManifest));
    const existing = await loadExisting(paths.metadataFile);
    validateMetadataPaths(paths, existing.values());
    const mediaItems = [...existing.values()].filter((item) => ["image", "video"].includes(item?.FileSystem?.FileType));
    const stats = await ensureThumbnailsForItems(mediaItems, {
      workspaceRoot: paths.root,
      cacheDir: paths.thumbnailDir,
      options: thumbnailConfig,
      maxConcurrency: thumbnailConfig.maxConcurrency,
      mediaConfig: config.media,
      force,
      logger: (message) => logger.warn(message),
      onGenerated: options.onGenerated,
      onProgress: (progress) => emit({ phase: "thumbnails", ...progress }),
    });
    if (stats.failed === 0) {
      await writeTextAtomic(paths.thumbnailManifestFile, `${JSON.stringify(expectedManifest, null, 2)}\n`);
    }
    emit({ phase: "complete", processed: stats.total, total: stats.total, message: "缩略图生成完成" });
    return { ...stats, force, warnings, errors };
  } finally {
    await authorization.release();
  }
}

if (require.main === module) {
  run({ logger: console }).then((stats) => {
    console.log(`Thumbnail cache complete: total=${stats.total}, generated=${stats.generated}, skipped=${stats.skipped}, failed=${stats.failed}, force=${stats.force}`);
  }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { THUMBNAIL_GENERATOR_VERSION, buildThumbnailManifest, thumbnailManifestMatches, run };
