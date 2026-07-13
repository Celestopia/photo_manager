/**
 * Incrementally synchronize image and video metadata while preserving user fields.
 * Unchanged files are reused by size + millisecond mtime; SHA256 is computed only
 * for changed files and new paths that may represent moves.
 */
const path = require("node:path");
const fsp = require("node:fs/promises");
const {
  APP_ROOT,
  resolveConfig,
  walkFiles,
  inspectMediaFile,
  sha256File,
  buildMetadata,
  loadExisting,
  writeAll,
  extensionType,
} = require("./common");
const { validateMediaTools } = require("./media-tools");
const { parseLibraryArgument, writeLibraryManifest } = require("./library-core");
const { validateExistingLibrary, authorizeLibraryOperation, validateMetadataPaths } = require("./library-access");
const { createLibraryBackup } = require("./library-backup");
const { recoverPendingTransaction } = require("./library-transaction");
const { createOperationReporter } = require("./operation-progress");

function isUnchangedRecord(existing, snapshot) {
  return Boolean(
    existing
    && existing?.FileSystem?.FileType === snapshot.type
    && Number(existing?.FileSystem?.FileSize) === Number(snapshot.stat.size)
    && Number.isFinite(Number(existing?.FileSystem?.ModificationTimeMs))
    && Number(existing.FileSystem.ModificationTimeMs) === Number(snapshot.stat.mtimeMs)
    && (snapshot.type !== "image" || ["ok", "failed"].includes(existing?.Picture?.ProbeStatus))
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

async function synchronizeMetadata({ config, root, existing, files, logger = console, dependencies = {}, onProgress = null }) {
  const inspectFile = dependencies.inspectMediaFile || inspectMediaFile;
  const hashFile = dependencies.sha256File || sha256File;
  const buildFileMetadata = dependencies.buildMetadata || buildMetadata;
  const snapshots = [];
  const failedPaths = new Set();
  const sortedFiles = [...files].sort((a, b) => a.localeCompare(b));
  for (let fileIndex = 0; fileIndex < sortedFiles.length; fileIndex += 1) {
    const absFile = sortedFiles[fileIndex];
    if (!extensionType(path.extname(absFile))) continue;
    onProgress?.({ phase: "inspect", processed: fileIndex, total: sortedFiles.length, current: path.relative(root, absFile).replace(/\\/g, "/") });
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
  for (let snapshotIndex = 0; snapshotIndex < snapshots.length; snapshotIndex += 1) {
    const snapshot = snapshots[snapshotIndex];
    onProgress?.({ phase: "metadata", processed: snapshotIndex, total: snapshots.length, current: snapshot.relativePath });
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
  const duplicateHashes = new Map();
  for (const item of next.values()) {
    if (!item.SHA256Hash) continue;
    if (!duplicateHashes.has(item.SHA256Hash)) duplicateHashes.set(item.SHA256Hash, []);
    duplicateHashes.get(item.SHA256Hash).push(item.FilePath);
  }
  for (const [hash, filePaths] of duplicateHashes) {
    if (filePaths.length > 1) logger.warn(`Duplicate SHA-256 ${hash}: ${filePaths.sort().join(", ")}`);
  }
  return { next, stats };
}

async function run(options = {}) {
  const config = options.config || resolveConfig();
  const paths = options.paths || parseLibraryArgument();
  const { emit, logger, warnings, errors } = createOperationReporter({ ...options, logger: options.logger || console });
  await validateMediaTools(APP_ROOT, config.media);
  const manifest = await validateExistingLibrary(paths, { onProgress: (progress) => emit(progress) });
  const authorization = await authorizeLibraryOperation(paths, manifest, options);
  try {
    await recoverPendingTransaction(paths);
    emit({ phase: "backup", message: "备份图库数据" });
    await createLibraryBackup(paths, {
      kind: "update",
      reason: "metadata-update",
      retentionCount: config.backup.retentionCount,
    });
    const existing = await loadExisting(paths.metadataFile);
    validateMetadataPaths(paths, existing.values());
    const files = await walkFiles(paths.root, { onProgress: (progress) => emit(progress) });
    const result = await synchronizeMetadata({
      config,
      root: paths.root,
      existing,
      files,
      logger,
      onProgress: (progress) => emit(progress),
    });
    const nextEntries = [...result.next.values()];
    emit({ phase: "commit", processed: nextEntries.length, total: nextEntries.length, message: "原子写入元数据" });
    await writeAll(paths.metadataFile, nextEntries);
    const retainedHashes = new Set(nextEntries.map((item) => item?.SHA256Hash).filter(Boolean));
    const staleHashes = new Set(
      [...existing.values()]
        .map((item) => item?.SHA256Hash)
        .filter((hash) => hash && !retainedHashes.has(hash)),
    );
    let thumbnailsRemoved = 0;
    for (const hash of staleHashes) {
      try {
        await fsp.rm(path.join(paths.thumbnailDir, `${hash}.webp`), { force: true });
        thumbnailsRemoved += 1;
      } catch (error) {
        logger.warn(`Failed to remove stale thumbnail ${hash}: ${error.message}`);
      }
    }
    manifest.updatedAt = new Date().toISOString();
    await writeLibraryManifest(paths, manifest);
    const summary = {
      ...result.stats,
      total: nextEntries.length,
      images: nextEntries.filter((item) => item?.FileSystem?.FileType === "image").length,
      videos: nextEntries.filter((item) => item?.FileSystem?.FileType === "video").length,
      probeFailed: nextEntries.filter((item) => item?.Video?.ProbeStatus === "failed" || item?.Picture?.ProbeStatus === "failed").length,
      thumbnailsRemoved,
      warnings,
      errors,
    };
    emit({ phase: "complete", processed: summary.total, total: summary.total, message: "元数据更新完成" });
    return summary;
  } finally {
    await authorization.release();
  }
}

if (require.main === module) {
  run({ logger: console }).then((result) => {
    console.log(`Updated metadata: total=${result.total}, images=${result.images}, videos=${result.videos}, reused=${result.reused}, hashed=${result.hashed}, rebuilt=${result.rebuilt}, moved=${result.moved}, failed=${result.failed}, skipped=${result.skipped}, probeFailed=${result.probeFailed}`);
  }).catch((error) => {
    console.error(error.message);
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
