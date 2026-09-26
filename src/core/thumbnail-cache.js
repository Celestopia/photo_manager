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
  sanitizeMediaError,
} = require("./media-tools");
const { extractFirstVideoFrame } = require("./video-first-frame");
const { resolveProgramResourceRoot } = require("./program-paths.js");
const { assertSha256Hash } = require("../shared/media-technical-schema");

const APP_ROOT = resolveProgramResourceRoot();

const { DEFAULT_THUMBNAIL_CONFIG, normalizeThumbnailConfig } = require("./thumbnail-config");

/**
 * Build deterministic thumbnail file name from SHA256 hash.
 */
function thumbnailFileNameFromHash(hash) {
  return `${assertSha256Hash(hash)}.webp`;
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
  if (Math.max(tallRatio, wideRatio) >= extremeAspectRatio) {
    // Keep the top/left square for either extreme aspect ratio.
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
  const extractFrame = dependencies.extractFirstVideoFrame || extractFirstVideoFrame;
  const renderThumbnail = dependencies.generateThumbnail || generateThumbnail;
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.png`,
  );
  let completed = false;
  try {
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await extractFrame(sourcePath, tempPath, APP_ROOT, mediaConfig, { maxEdge: Infinity, signal: dependencies.signal });
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
    libraryRoot,
    cacheDir,
    options,
  } = params;

  const hash = item?.SHA256Hash;
  const filePath = item?.FilePath;
  const fileType = item?.FileSystem?.FileType;
  if (!hash || !filePath || !["image", "video"].includes(fileType)) return false;

  const sourcePath = path.join(libraryRoot, filePath);
  const targetPath = thumbnailAbsolutePath(cacheDir, hash);
  if (fs.existsSync(targetPath) && !params.force) return false;
  if (!fs.existsSync(sourcePath)) return false;

  await fsp.mkdir(cacheDir, { recursive: true });
  try {
    if (fileType === "video") {
      await generateVideoThumbnail(item, sourcePath, targetPath, options, params.mediaConfig, { signal: params.signal });
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
    libraryRoot,
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
  const cancelled = () => Boolean(params.signal?.aborted || isCancelled?.());

  const estimateWork = [];
  async function runQueue(queue, concurrency, id) {
    const pending = new Set(queue.filter(item => force || !fs.existsSync(thumbnailAbsolutePath(cacheDir, item.SHA256Hash))));
    const work = { id, processed: 0, total: pending.size };
    estimateWork.push(work);
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
            libraryRoot,
            cacheDir,
            options,
            mediaConfig,
            force,
            signal: params.signal,
          });
          if (didGenerate) {
            generated += 1;
            notifyGenerated(item, thumbnailAbsolutePath(cacheDir, item.SHA256Hash));
          } else {
            skipped += 1;
          }
        } catch (error) {
          failed += 1;
          const sourcePath = item?.FilePath ? path.join(libraryRoot, item.FilePath) : "";
          log(`Thumbnail generation failed for ${item?.FilePath || "unknown"}: ${sanitizeMediaError(error, sourcePath)}`);
        } finally {
          if (pending.has(item)) work.processed++;
          notifyProgress({ estimateWork: estimateWork.map(group => ({ ...group })), total: list.length, processed: generated + skipped + failed, generated, skipped, failed, current: item?.FilePath || "" });
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
    runQueue(imageItems, maxConcurrency, "images"),
    runQueue(videoItems, mediaConfig.videoThumbnailConcurrency, "videos"),
  ]);
  params.signal?.throwIfAborted();
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
