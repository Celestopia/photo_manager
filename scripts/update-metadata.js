/**
 * Incrementally synchronize image and video metadata while preserving user fields.
 * Unchanged files are reused by size + millisecond mtime; SHA256 is computed only
 * for changed files and new paths that may represent moves.
 */
const path = require("node:path");
const {
  APP_ROOT,
  DATA_FILE_NAMES,
  resolveConfig,
  absFromConfig,
  dataFilePath,
  ensureDataDir,
  walkFiles,
  inspectMediaFile,
  sha256File,
  buildMetadata,
  loadExisting,
  writeAll,
  extensionType,
} = require("./common");
const { normalizeThumbnailConfig, ensureThumbnailsForItems } = require("./thumbnail-cache");
const { validateMediaTools } = require("./media-tools");

function isUnchangedRecord(existing, snapshot) {
  return Boolean(
    existing
    && existing?.FileSystem?.FileType === snapshot.type
    && Number(existing?.FileSystem?.FileSize) === Number(snapshot.stat.size)
    && Number.isFinite(Number(existing?.FileSystem?.ModificationTimeMs))
    && Number(existing.FileSystem.ModificationTimeMs) === Number(snapshot.stat.mtimeMs)
  );
}

function preserveUserFields(built, existing) {
  if (!existing) return built;
  built.Customization = existing.Customization || built.Customization;
  built.Location = { ...(built.Location || {}), ...(existing.Location || {}) };
  if (built.Customization && Object.prototype.hasOwnProperty.call(built.Customization, "Category")) {
    delete built.Customization.Category;
  }
  return built;
}

function cloneMovedRecord(existing, snapshot, hash) {
  const moved = structuredClone(existing);
  moved.FilePath = snapshot.relativePath;
  moved.SHA256Hash = hash;
  moved.FileSystem = {
    ...(moved.FileSystem || {}),
    FileType: snapshot.type,
    FileExtension: snapshot.ext.replace(".", "").toLowerCase(),
    FileSize: snapshot.stat.size,
    CreationTimeString: snapshot.creation.text,
    CreationTimeZone: snapshot.creation.zone,
    CreationTimeStamp: snapshot.creation.stamp,
    ModificationTimeString: snapshot.modified.text,
    ModificationTimeZone: snapshot.modified.zone,
    ModificationTimeStamp: snapshot.modified.stamp,
    ModificationTimeMs: snapshot.stat.mtimeMs,
  };
  if (moved.Customization && Object.prototype.hasOwnProperty.call(moved.Customization, "Category")) {
    delete moved.Customization.Category;
  }
  return moved;
}

async function synchronizeMetadata({ config, root, existing, files, logger = console, dependencies = {} }) {
  const inspectFile = dependencies.inspectMediaFile || inspectMediaFile;
  const hashFile = dependencies.sha256File || sha256File;
  const buildFileMetadata = dependencies.buildMetadata || buildMetadata;
  const snapshots = [];
  const failedPaths = new Set();
  for (const absFile of [...files].sort((a, b) => a.localeCompare(b, "zh-CN"))) {
    if (!extensionType(path.extname(absFile))) continue;
    try {
      const snapshot = await inspectFile(absFile, root);
      if (snapshot) snapshots.push(snapshot);
    } catch (error) {
      const relativePath = path.relative(root, absFile).replace(/\\/g, "/");
      failedPaths.add(relativePath);
      logger.warn(`Keep previous metadata after filesystem read failure: ${relativePath} (${error.message})`);
    }
  }

  const livePaths = new Set(snapshots.map((snapshot) => snapshot.relativePath));
  const movedCandidatesByHash = new Map();
  for (const item of existing.values()) {
    if (livePaths.has(item.FilePath) || failedPaths.has(item.FilePath) || !item.SHA256Hash) continue;
    if (!movedCandidatesByHash.has(item.SHA256Hash)) movedCandidatesByHash.set(item.SHA256Hash, []);
    movedCandidatesByHash.get(item.SHA256Hash).push(item);
  }
  for (const candidates of movedCandidatesByHash.values()) {
    candidates.sort((a, b) => String(a.FilePath).localeCompare(String(b.FilePath), "zh-CN"));
  }

  const next = new Map();
  const stats = {
    reused: 0,
    hashed: 0,
    rebuilt: 0,
    moved: 0,
    failed: failedPaths.size,
    skipped: [...failedPaths].filter((filePath) => !existing.has(filePath)).length,
  };
  for (const snapshot of snapshots) {
    const direct = existing.get(snapshot.relativePath);
    if (isUnchangedRecord(direct, snapshot)) {
      next.set(snapshot.relativePath, direct);
      stats.reused += 1;
      continue;
    }

    try {
      if (direct) {
        const built = preserveUserFields(await buildFileMetadata(snapshot.filePath, root, {
          snapshot,
          mediaConfig: config.media,
        }), direct);
        next.set(snapshot.relativePath, built);
        stats.hashed += 1;
        stats.rebuilt += 1;
        continue;
      }

      const hash = await hashFile(snapshot.filePath);
      stats.hashed += 1;
      const movedCandidates = movedCandidatesByHash.get(hash) || [];
      const movedIndex = movedCandidates.findIndex(
        (candidate) => candidate?.FileSystem?.FileType === snapshot.type,
      );
      const movedFrom = movedIndex >= 0 ? movedCandidates.splice(movedIndex, 1)[0] : null;
      if (movedFrom) {
        next.set(snapshot.relativePath, cloneMovedRecord(movedFrom, snapshot, hash));
        stats.moved += 1;
      } else {
        const built = await buildFileMetadata(snapshot.filePath, root, {
          snapshot,
          hash,
          mediaConfig: config.media,
        });
        next.set(snapshot.relativePath, built);
        stats.rebuilt += 1;
      }
    } catch (error) {
      stats.failed += 1;
      if (direct) {
        next.set(snapshot.relativePath, direct);
        logger.warn(`Keep previous metadata after rebuild failure: ${snapshot.relativePath} (${error.message})`);
      } else {
        stats.skipped += 1;
        logger.warn(`Skip new media after hash/build failure: ${snapshot.relativePath} (${error.message})`);
      }
    }
  }

  for (const failedPath of failedPaths) {
    const previous = existing.get(failedPath);
    if (previous) next.set(failedPath, previous);
  }
  return { next, stats };
}

async function run() {
  const config = resolveConfig();
  const root = absFromConfig(config, config.workspaceRoot);
  await ensureDataDir(config);
  await validateMediaTools(APP_ROOT, config.media);
  const metadataFile = dataFilePath(config, DATA_FILE_NAMES.metadata);
  const thumbnailConfig = normalizeThumbnailConfig(config.thumbnail);
  const thumbnailDir = absFromConfig(config, thumbnailConfig.dir);
  const existing = await loadExisting(metadataFile);
  const files = await walkFiles(root);
  const result = await synchronizeMetadata({ config, root, existing, files });
  const nextEntries = [...result.next.values()];
  await writeAll(metadataFile, nextEntries);

  const thumbnailStats = await ensureThumbnailsForItems(nextEntries, {
    workspaceRoot: root,
    cacheDir: thumbnailDir,
    options: thumbnailConfig,
    maxConcurrency: thumbnailConfig.maxConcurrency,
    mediaConfig: config.media,
    logger: (message) => console.warn(message),
  });
  const imageCount = nextEntries.filter((item) => item?.FileSystem?.FileType === "image").length;
  const videoCount = nextEntries.filter((item) => item?.FileSystem?.FileType === "video").length;
  const probeFailures = nextEntries.filter((item) => item?.Video?.ProbeStatus === "failed").length;
  console.log(
    `Updated metadata: total=${nextEntries.length}, images=${imageCount}, videos=${videoCount}, reused=${result.stats.reused}, hashed=${result.stats.hashed}, rebuilt=${result.stats.rebuilt}, moved=${result.stats.moved}, failed=${result.stats.failed}, skipped=${result.stats.skipped}, probeFailed=${probeFailures}`,
  );
  console.log(
    `Thumbnail cache: generated=${thumbnailStats.generated}, skipped=${thumbnailStats.skipped}, failed=${thumbnailStats.failed}`,
  );
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  isUnchangedRecord,
  preserveUserFields,
  cloneMovedRecord,
  synchronizeMetadata,
  run,
};
