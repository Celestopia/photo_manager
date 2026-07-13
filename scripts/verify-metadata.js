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
const { parseLibraryArgument } = require("./library-core");
const { validateExistingLibrary, authorizeLibraryOperation, validateMetadataPaths } = require("./library-access");
const { createOperationReporter } = require("./operation-progress");
const { readTransactionJournal } = require("./library-transaction");

function approximatelyEqual(a, b, tolerance = 0.1) {
  if (a === null || a === undefined || b === null || b === undefined) return a == null && b == null;
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

async function run(options = {}) {
  const config = options.config || resolveConfig();
  const paths = options.paths || parseLibraryArgument();
  const reprobe = options.reprobe ?? process.argv.includes("--probe");
  const { emit, logger, warnings, errors } = createOperationReporter({ ...options, logger: options.logger || console });
  if (reprobe) await validateMediaTools(APP_ROOT, config.media, { requireFfmpeg: false, requireFfprobe: true });
  const manifest = await validateExistingLibrary(paths, { onProgress: (progress) => emit(progress) });
  const authorization = await authorizeLibraryOperation(paths, manifest, options);
  try {
    if (await readTransactionJournal(paths)) throw new Error("A pending library transaction must be recovered by opening the library before verification");
    const existing = await loadExisting(paths.metadataFile);
    validateMetadataPaths(paths, existing.values());
    const files = (await walkFiles(paths.root, { onProgress: (progress) => emit(progress) }))
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
    };
  for (let index = 0; index < files.length; index += 1) {
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
      const liveHash = await sha256File(absFile);
      if (current.SHA256Hash !== liveHash) {
        counts.tampered += 1;
        logger.warn(`[TAMPERED] ${relativePath}`);
      }
    } catch (error) {
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
  emit({ phase: "complete", processed: counts.checked, total: files.length, message: "元数据检查完成" });
  return { ...counts, warnings, errors };
  } finally {
    await authorization.release();
  }
}

if (require.main === module) {
  run({ logger: console }).then((counts) => {
    console.log(`Verify done: checked=${counts.checked}, missing=${counts.missing}, extra=${counts.extra}, tampered=${counts.tampered}, typeMismatch=${counts.typeMismatch}, probeFailed=${counts.probeFailed}, probeChanged=${counts.probeChanged}, readFailed=${counts.readFailed}`);
  }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { approximatelyEqual, run };
