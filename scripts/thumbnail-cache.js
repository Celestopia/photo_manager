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
const crypto = require("node:crypto");
const sharp = require("sharp");
const {
  normalizeMediaConfig,
  calculateVideoThumbnailTime,
  extractVideoFrame,
  sanitizeMediaError,
} = require("./media-tools");

const APP_ROOT = path.resolve(__dirname, "..");

const DEFAULT_THUMBNAIL_CONFIG = {
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

async function generateVideoThumbnail(item, sourcePath, targetPath, options, mediaConfig, dependencies = {}) {
  const extractFrame = dependencies.extractVideoFrame || extractVideoFrame;
  const renderThumbnail = dependencies.generateThumbnail || generateThumbnail;
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.png`,
  );
  const seekTime = calculateVideoThumbnailTime(item?.Video?.DurationSeconds);
  let completed = false;
  try {
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    try {
      await extractFrame(sourcePath, tempPath, seekTime, APP_ROOT, mediaConfig);
    } catch (firstError) {
      if (seekTime <= 0) throw firstError;
      await fsp.rm(tempPath, { force: true });
      await extractFrame(sourcePath, tempPath, 0, APP_ROOT, mediaConfig);
    }
    await renderThumbnail(tempPath, targetPath, options);
    completed = true;
  } finally {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    if (!completed) await fsp.rm(targetPath, { force: true }).catch(() => {});
  }
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
  if (!hash || !filePath || !["image", "video"].includes(fileType)) return false;

  const sourcePath = path.join(workspaceRoot, filePath);
  const targetPath = thumbnailAbsolutePath(cacheDir, hash);
  if (fs.existsSync(targetPath) && !params.force) return false;
  if (!fs.existsSync(sourcePath)) return false;

  await fsp.mkdir(cacheDir, { recursive: true });
  try {
    if (fileType === "video") {
      await generateVideoThumbnail(item, sourcePath, targetPath, options, params.mediaConfig);
    } else {
      await generateThumbnail(sourcePath, targetPath, options);
    }
  } catch (error) {
    await fsp.rm(targetPath, { force: true }).catch(() => {});
    throw error;
  }
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
    onGenerated,
    onProgress,
    isCancelled,
    force = false,
  } = params;
  const mediaConfig = normalizeMediaConfig(params.mediaConfig);

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  const log = typeof logger === "function" ? logger : () => {};
  const notifyGenerated = typeof onGenerated === "function" ? onGenerated : () => {};
  const notifyProgress = typeof onProgress === "function" ? onProgress : () => {};
  const cancelled = typeof isCancelled === "function" ? isCancelled : () => false;

  async function runQueue(queue, concurrency) {
    let index = 0;
    const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, queue.length));
    async function worker() {
      while (true) {
        if (cancelled()) return;
        const currentIndex = index;
        index += 1;
        if (currentIndex >= queue.length) return;
        const item = queue[currentIndex];
        try {
          const didGenerate = await ensureThumbnailForItem(item, {
            workspaceRoot,
            cacheDir,
            options,
            mediaConfig,
            force,
          });
          if (didGenerate) {
            generated += 1;
            notifyGenerated(item, thumbnailAbsolutePath(cacheDir, item.SHA256Hash));
          } else {
            skipped += 1;
          }
        } catch (error) {
          failed += 1;
          const sourcePath = item?.FilePath ? path.join(workspaceRoot, item.FilePath) : "";
          log(`Thumbnail generation failed for ${item?.FilePath || "unknown"}: ${sanitizeMediaError(error, sourcePath)}`);
        } finally {
          notifyProgress({ total: list.length, processed: generated + skipped + failed, generated, skipped, failed, current: item?.FilePath || "" });
        }
      }
    }
    await Promise.all(new Array(workerCount).fill(0).map(() => worker()));
  }

  const unique = [];
  const seenHashes = new Set();
  for (const item of list) {
    if (!item?.SHA256Hash || seenHashes.has(item.SHA256Hash)) continue;
    seenHashes.add(item.SHA256Hash);
    unique.push(item);
  }
  const imageItems = unique.filter((item) => item?.FileSystem?.FileType === "image");
  const videoItems = unique.filter((item) => item?.FileSystem?.FileType === "video");
  const unsupportedCount = unique.length - imageItems.length - videoItems.length;
  skipped += list.length - unique.length;
  skipped += unsupportedCount;
  await Promise.all([
    runQueue(imageItems, maxConcurrency),
    runQueue(videoItems, mediaConfig.videoThumbnailConcurrency),
  ]);
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
  generateVideoThumbnail,
  ensureThumbnailForItem,
  ensureThumbnailsForItems,
};
