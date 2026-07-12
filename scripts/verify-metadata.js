/** Verify image and video metadata without modifying JSONL. */
const path = require("node:path");
const {
  APP_ROOT,
  DATA_FILE_NAMES,
  resolveConfig,
  absFromConfig,
  dataFilePath,
  walkFiles,
  sha256File,
  loadExisting,
  extensionType,
} = require("./common");
const { validateMediaTools, probeVideoFile, sanitizeMediaError } = require("./media-tools");

function approximatelyEqual(a, b, tolerance = 0.1) {
  if (a === null || a === undefined || b === null || b === undefined) return a == null && b == null;
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

async function run() {
  const config = resolveConfig();
  const root = absFromConfig(config, config.workspaceRoot);
  const metadataFile = dataFilePath(config, DATA_FILE_NAMES.metadata);
  const reprobe = process.argv.includes("--probe");
  if (reprobe) await validateMediaTools(APP_ROOT, config.media, { requireFfmpeg: false, requireFfprobe: true });

  const existing = await loadExisting(metadataFile);
  const files = (await walkFiles(root)).filter((file) => extensionType(path.extname(file)));
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

  for (const absFile of files) {
    const relativePath = path.relative(root, absFile).replace(/\\/g, "/");
    liveRelativePaths.add(relativePath);
    const current = existing.get(relativePath);
    if (!current) {
      counts.missing += 1;
      console.warn(`[MISSING] ${relativePath} does not exist in metadata file.`);
      continue;
    }
    counts.checked += 1;
    const expectedType = extensionType(path.extname(absFile));
    if (current?.FileSystem?.FileType !== expectedType) {
      counts.typeMismatch += 1;
      console.warn(`[TYPE] ${relativePath}: metadata=${current?.FileSystem?.FileType || "unknown"}, disk=${expectedType}`);
    }
    try {
      const liveHash = await sha256File(absFile);
      if (current.SHA256Hash !== liveHash) {
        counts.tampered += 1;
        console.warn(`[TAMPERED] ${relativePath}`);
      }
    } catch (error) {
      counts.readFailed += 1;
      console.warn(`[READ-FAILED] ${relativePath}: ${error.message}`);
    }

    if (expectedType !== "video") continue;
    if (current?.Video?.ProbeStatus === "failed") {
      counts.probeFailed += 1;
      console.warn(`[PROBE-FAILED] ${relativePath}: ${current.Video.ProbeError || "Unknown probe error"}`);
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
        console.warn(`[PROBE-CHANGED] ${relativePath}`);
      }
    } catch (error) {
      counts.probeChanged += 1;
      console.warn(`[REPROBE-FAILED] ${relativePath}: ${sanitizeMediaError(error, absFile)}`);
    }
  }

  for (const filePath of existing.keys()) {
    if (liveRelativePaths.has(filePath)) continue;
    counts.extra += 1;
    console.warn(`[EXTRA] ${filePath} exists in metadata but not in workspace.`);
  }

  console.log(
    `Verify done: checked=${counts.checked}, missing=${counts.missing}, extra=${counts.extra}, tampered=${counts.tampered}, typeMismatch=${counts.typeMismatch}, probeFailed=${counts.probeFailed}, probeChanged=${counts.probeChanged}, readFailed=${counts.readFailed}`,
  );
  return counts;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { approximatelyEqual, run };
