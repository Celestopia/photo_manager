/** Verify image and video metadata without modifying JSONL. */
const path = require("node:path");
const {
  APP_ROOT,
  resolveConfig,
  walkFiles,
  sha256File,
  loadExisting,
  extensionType,
} = require("./common");
const { validateMediaTools, probeVideoFile, sanitizeMediaError } = require("./media-tools");
const { validateExistingLibrary, authorizeLibraryOperation, validateMetadataPaths } = require("./library-access");
const { createOperationReporter } = require("./operation-progress");
const { assertLibraryReady } = require("./library-recovery");
const { loadRegistryIndexes, validateMetadataMap } = require("./library-data.js");

function approximatelyEqual(a, b, tolerance = 0.1) {
  if (a === null || a === undefined || b === null || b === undefined) return a == null && b == null;
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

async function run(options = {}) {
  options.signal?.throwIfAborted();
  const config = options.config || resolveConfig();
  const paths = options.paths;
  const reprobe = options.reprobe ?? false;
  const { emit, logger, warnings, errors } = createOperationReporter({ ...options, logger: options.logger || console });
  if (reprobe) await validateMediaTools(APP_ROOT, config.media, { requireFfmpeg: false, requireFfprobe: true });
  const manifest = await validateExistingLibrary(paths, { onProgress: (progress) => emit(progress), signal: options.signal });
  const authorization = await authorizeLibraryOperation(paths, manifest, options);
  try {
    assertLibraryReady(paths);
    const existing = await loadExisting(paths.metadataFile);
    const registries = await loadRegistryIndexes(paths);
    validateMetadataMap(existing, registries);
    validateMetadataPaths(paths, existing.values());
    const files = (await walkFiles(paths.root, { signal: options.signal, onProgress: (progress) => emit(progress) }))
      .filter((file) => extensionType(path.extname(file)));
    const liveRelativePaths = new Set();
    const counts = {
    checked: 0,
    missing: 0,
    extra: 0,
    tampered: 0,
    typeMismatch: 0,
    probeFailed: 0,
    probeChanged: 0,
    readFailed: 0,
    privacyInvalid: 0,
    };
  for (let index = 0; index < files.length; index += 1) {
    options.signal?.throwIfAborted();
    const absFile = files[index];
    const relativePath = path.relative(paths.root, absFile).replace(/\\/g, "/");
    emit({ phase: "verify", processed: index, total: files.length, current: relativePath });
    liveRelativePaths.add(relativePath);
    const current = existing.get(relativePath);
    if (!current) {
      counts.missing += 1;
      logger.warn(`[MISSING] ${relativePath} does not exist in metadata file.`);
      continue;
    }
    counts.checked += 1;
    const expectedType = extensionType(path.extname(absFile));
    if (current?.FileSystem?.FileType !== expectedType) {
      counts.typeMismatch += 1;
      logger.warn(`[TYPE] ${relativePath}: metadata=${current?.FileSystem?.FileType || "unknown"}, disk=${expectedType}`);
    }
    try {
      const liveHash = await sha256File(absFile, { signal: options.signal });
      if (current.SHA256Hash !== liveHash) {
        counts.tampered += 1;
        logger.warn(`[TAMPERED] ${relativePath}`);
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      counts.readFailed += 1;
      logger.warn(`[READ-FAILED] ${relativePath}: ${error.message}`);
    }

    if (expectedType === "image" && current?.Picture?.ProbeStatus === "failed") {
      counts.probeFailed += 1;
      logger.warn(`[PROBE-FAILED] ${relativePath}: ${current.Picture.ProbeError || "Unknown image decode error"}`);
    }
    if (expectedType !== "video") continue;
    if (current?.Video?.ProbeStatus === "failed") {
      counts.probeFailed += 1;
      logger.warn(`[PROBE-FAILED] ${relativePath}: ${current.Video.ProbeError || "Unknown probe error"}`);
    }
    if (!reprobe) continue;
    try {
      const fresh = await probeVideoFile(absFile, APP_ROOT, config.media);
      const stored = current.Video || {};
      const changed = fresh.video.ProbeStatus !== stored.ProbeStatus
        || fresh.video.VideoCodec !== stored.VideoCodec
        || fresh.video.Width !== stored.Width
        || fresh.video.Height !== stored.Height
        || !approximatelyEqual(fresh.video.DurationSeconds, stored.DurationSeconds);
      if (changed) {
        counts.probeChanged += 1;
        logger.warn(`[PROBE-CHANGED] ${relativePath}`);
      }
    } catch (error) {
      counts.probeChanged += 1;
      logger.warn(`[REPROBE-FAILED] ${relativePath}: ${sanitizeMediaError(error, absFile)}`);
    }
  }

  for (const filePath of existing.keys()) {
    if (liveRelativePaths.has(filePath)) continue;
    counts.extra += 1;
    logger.warn(`[EXTRA] ${filePath} exists in metadata but not in workspace.`);
  }
  options.signal?.throwIfAborted();
  emit({ phase: "complete", processed: counts.checked, total: files.length, message: "Metadata verification complete" });
  return { ...counts, warnings, errors };
  } finally {
    await authorization.release();
  }
}

module.exports = { approximatelyEqual, run };
