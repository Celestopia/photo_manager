const { loadRegistryIndexes, validateMetadataMap } = require("./library-data");
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
const { writeTextAtomic } = require("./library-core");
const { validateExistingLibrary, authorizeLibraryOperation, validateMetadataPaths } = require("./library-access");
const { createOperationReporter } = require("./operation-progress");
const { assertLibraryReady } = require("./library-recovery");

const THUMBNAIL_GENERATOR_VERSION = 2;

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
  options.signal?.throwIfAborted();
  const config = options.config || resolveConfig();
  const paths = options.paths;
  const { emit, logger, warnings, errors } = createOperationReporter({ ...options, logger: options.logger || console });
  const manifest = await validateExistingLibrary(paths, { onProgress: (progress) => emit(progress), signal: options.signal });
  const authorization = await authorizeLibraryOperation(paths, manifest, options);
  try {
    assertLibraryReady(paths);
    await validateMediaTools(APP_ROOT, config.media);
    const thumbnailConfig = normalizeThumbnailConfig(config.thumbnail);
    const expectedManifest = buildThumbnailManifest(thumbnailConfig);
    let currentManifest = null;
    if (fs.existsSync(paths.thumbnailManifestFile)) {
      try { currentManifest = JSON.parse(await fsp.readFile(paths.thumbnailManifestFile, "utf8")); } catch { currentManifest = null; }
    }
    const force = Boolean(options.force ?? false) || !thumbnailManifestMatches(currentManifest, expectedManifest);
    const existing = await loadExisting(paths.metadataFile);
    validateMetadataPaths(paths, existing.values());
    validateMetadataMap(existing, await loadRegistryIndexes(paths));
    const mediaItems = [...existing.values()].filter((item) => ["image", "video"].includes(item?.FileSystem?.FileType));
    const stats = await ensureThumbnailsForItems(mediaItems, {
      libraryRoot: paths.root,
      cacheDir: paths.thumbnailDir,
      options: thumbnailConfig,
      maxConcurrency: thumbnailConfig.maxConcurrency,
      mediaConfig: config.media,
      force,
      logger: (message) => logger.warn(message),
      onGenerated: options.onGenerated,
      signal: options.signal,
      onProgress: (progress) => emit({ phase: "thumbnails", ...progress }),
    });
    options.signal?.throwIfAborted();
    if (stats.failed === 0) {
      await writeTextAtomic(paths.thumbnailManifestFile, `${JSON.stringify(expectedManifest, null, 2)}\n`);
    }
    emit({ phase: "complete", processed: stats.total, total: stats.total, message: "Thumbnail generation complete" });
    return { ...stats, force, warnings, errors };
  } finally {
    await authorization.release();
  }
}

module.exports = { THUMBNAIL_GENERATOR_VERSION, buildThumbnailManifest, thumbnailManifestMatches, run };
