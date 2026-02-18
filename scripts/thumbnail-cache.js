/**
 * Shared thumbnail cache utilities.
 *
 * This module centralizes:
 * - thumbnail config normalization
 * - deterministic thumbnail filename/path by SHA256 hash
 * - thumbnail generation for normal and extreme-aspect images
 * - concurrent cache warmup over a metadata item list
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const DEFAULT_THUMBNAIL_CONFIG = {
  dir: "./thumb_cache",
  size: 320,
  webpQuality: 80,
  extremeAspectRatio: 4,
  maxConcurrency: 4,
};

/**
 * Normalize thumbnail-related config values into safe runtime numbers.
 */
function normalizeThumbnailConfig(configThumbnail) {
  const raw = configThumbnail || {};
  return {
    ...DEFAULT_THUMBNAIL_CONFIG,
    ...raw,
    size: Math.max(64, Number(raw.size || DEFAULT_THUMBNAIL_CONFIG.size)),
    webpQuality: Math.max(1, Math.min(100, Number(raw.webpQuality || DEFAULT_THUMBNAIL_CONFIG.webpQuality))),
    extremeAspectRatio: Math.max(2, Number(raw.extremeAspectRatio || DEFAULT_THUMBNAIL_CONFIG.extremeAspectRatio)),
    maxConcurrency: Math.max(1, Number(raw.maxConcurrency || DEFAULT_THUMBNAIL_CONFIG.maxConcurrency)),
  };
}

/**
 * Build deterministic thumbnail file name from SHA256 hash.
 */
function thumbnailFileNameFromHash(hash) {
  return `${String(hash || "").trim()}.webp`;
}

/**
 * Build deterministic absolute thumbnail path from cache directory and hash.
 */
function thumbnailAbsolutePath(cacheDir, hash) {
  return path.join(cacheDir, thumbnailFileNameFromHash(hash));
}

/**
 * Create thumbnail payload with long-image crop strategy:
 * - very tall image: crop top square area
 * - very wide image: crop left square area
 * - normal image: center-crop cover fit
 */
async function generateThumbnail(sourcePath, targetPath, options) {
  const { size, webpQuality, extremeAspectRatio } = options;
  const image = sharp(sourcePath, { failOn: "none" });
  const meta = await image.metadata();

  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);
  if (!width || !height) {
    throw new Error("Invalid image dimensions");
  }

  const tallRatio = height / width;
  const wideRatio = width / height;

  let pipeline = sharp(sourcePath, { failOn: "none" });
  if (tallRatio >= extremeAspectRatio) {
    // Keep only top content for very tall screenshots.
    const cropSize = Math.max(1, Math.min(width, height));
    pipeline = pipeline.extract({ left: 0, top: 0, width: cropSize, height: cropSize });
  } else if (wideRatio >= extremeAspectRatio) {
    // Keep only left content for very wide screenshots.
    const cropSize = Math.max(1, Math.min(width, height));
    pipeline = pipeline.extract({ left: 0, top: 0, width: cropSize, height: cropSize });
  }

  await pipeline
    .resize(size, size, {
      fit: "cover",
      position: "centre",
      withoutEnlargement: true,
    })
    .webp({ quality: webpQuality })
    .toFile(targetPath);
}

/**
 * Ensure one metadata item has a cached thumbnail file.
 * Returns true only when a new thumbnail was generated.
 */
async function ensureThumbnailForItem(item, params) {
  const {
    workspaceRoot,
    cacheDir,
    options,
  } = params;

  const hash = item?.SHA256Hash;
  const filePath = item?.FilePath;
  const fileType = item?.FileSystem?.FileType;
  if (!hash || !filePath || fileType !== "image") return false;

  const sourcePath = path.join(workspaceRoot, filePath);
  const targetPath = thumbnailAbsolutePath(cacheDir, hash);
  if (fs.existsSync(targetPath)) return false;
  if (!fs.existsSync(sourcePath)) return false;

  await fsp.mkdir(cacheDir, { recursive: true });
  await generateThumbnail(sourcePath, targetPath, options);
  return true;
}

/**
 * Warm thumbnail cache for a list of metadata items with bounded concurrency.
 * Returns basic counters for logging/diagnostics.
 */
async function ensureThumbnailsForItems(items, params) {
  const list = Array.isArray(items) ? items : [];
  const {
    workspaceRoot,
    cacheDir,
    options,
    maxConcurrency,
    logger,
  } = params;

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  let index = 0;
  const workerCount = Math.min(maxConcurrency, Math.max(1, list.length));
  const log = typeof logger === "function" ? logger : () => {};

  async function worker() {
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= list.length) return;
      const item = list[currentIndex];
      try {
        const didGenerate = await ensureThumbnailForItem(item, {
          workspaceRoot,
          cacheDir,
          options,
        });
        if (didGenerate) generated += 1;
        else skipped += 1;
      } catch (error) {
        failed += 1;
        log(`Thumbnail generation failed for ${item?.FilePath || "unknown"}: ${error.message}`);
      }
    }
  }

  await Promise.all(new Array(workerCount).fill(0).map(() => worker()));
  return {
    total: list.length,
    generated,
    skipped,
    failed,
  };
}

module.exports = {
  DEFAULT_THUMBNAIL_CONFIG,
  normalizeThumbnailConfig,
  thumbnailFileNameFromHash,
  thumbnailAbsolutePath,
  ensureThumbnailForItem,
  ensureThumbnailsForItems,
};
