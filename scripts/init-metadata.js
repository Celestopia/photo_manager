/** Initialize a new PhotoManager library. */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  APP_ROOT,
  resolveConfig,
  walkFiles,
  buildMetadata,
  writeAll,
  extensionType,
} = require("./common");
const {
  DATA_FILE_NAMES,
  createLibraryManifest,
  ensureLibraryDirectories,
  assertDirectoryWritable,
  parseLibraryArgument,
  writeJsonlAtomic,
  writeLibraryManifest,
  writeTextAtomic,
  findNestedManagerDirectory,
  findParentManagerDirectory,
} = require("./library-core");
const { acquireLibraryLock, releaseLibraryLock } = require("./library-lock");
const { validateMediaTools } = require("./media-tools");
const { createOperationReporter } = require("./operation-progress");

async function run(options = {}) {
  const config = options.config || resolveConfig();
  const paths = options.paths || parseLibraryArgument();
  const { emit, logger, warnings, errors } = createOperationReporter(options);
  let cancelled = false;
  let lock = null;
  const cancel = () => { cancelled = true; };
  process.on?.("message", (message) => { if (message?.type === "cancel") cancel(); });

  if (fs.existsSync(paths.managerDir)) throw new Error(`Library data already exists: ${paths.managerDir}`);
  const rootStat = await fsp.stat(paths.root).catch(() => null);
  if (!rootStat?.isDirectory()) throw new Error(`Library directory does not exist: ${paths.root}`);
  const rootLinkStat = await fsp.lstat(paths.root);
  if (rootLinkStat.isSymbolicLink()) throw new Error("A symbolic-link directory cannot be used as a library root");
  const parentManager = findParentManagerDirectory(paths.root);
  if (parentManager) throw new Error(`The selected directory is inside another PhotoManager library: ${parentManager}`);
  emit({ phase: "validate", message: "验证图库目录" });
  await assertDirectoryWritable(paths.root);
  const nested = await findNestedManagerDirectory(paths.root, ({ visited, current }) => {
    emit({ phase: "scan-directories", current, processed: visited });
  }, () => cancelled);
  if (nested) throw new Error(`Nested PhotoManager library detected: ${nested}`);
  await validateMediaTools(APP_ROOT, config.media);

  const manifest = createLibraryManifest(paths.root, options.name || path.basename(paths.root));
  const marker = { Status: "initializing", StartedAt: new Date().toISOString(), Phase: "create-structure" };
  try {
    await ensureLibraryDirectories(paths);
    await writeLibraryManifest(paths, manifest);
    await writeTextAtomic(paths.initializationFile, `${JSON.stringify(marker, null, 2)}\n`);
    lock = await acquireLibraryLock(paths, manifest);
    emit({ phase: "scan", message: "扫描媒体文件" });
    const files = await walkFiles(paths.root, {
      isCancelled: () => cancelled,
      onProgress: ({ visitedDirectories, current }) => emit({
        phase: "scan",
        processed: visitedDirectories,
        current: path.relative(paths.root, current).replace(/\\/g, "/") || ".",
      }),
    });
    const mediaFiles = files.filter((file) => extensionType(path.extname(file))).sort((a, b) => a.localeCompare(b));
    const entries = [];
    for (let index = 0; index < mediaFiles.length; index += 1) {
      if (cancelled) {
        const error = new Error("Initialization cancelled");
        error.code = "OPERATION_CANCELLED";
        throw error;
      }
      const file = mediaFiles[index];
      const relative = path.relative(paths.root, file).replace(/\\/g, "/");
      emit({ phase: "metadata", processed: index, total: mediaFiles.length, current: relative });
      try {
        const item = await buildMetadata(file, paths.root, { mediaConfig: config.media });
        if (item) entries.push(item);
      } catch (error) {
        logger.warn(`Skip unreadable media: ${relative} (${error.message})`);
      }
    }

    const byHash = new Map();
    for (const item of entries) {
      if (!byHash.has(item.SHA256Hash)) byHash.set(item.SHA256Hash, []);
      byHash.get(item.SHA256Hash).push(item.FilePath);
    }
    for (const [hash, filePaths] of byHash) {
      if (filePaths.length > 1) logger.warn(`Duplicate SHA-256 ${hash}: ${filePaths.sort().join(", ")}`);
    }

    emit({ phase: "write", processed: entries.length, total: entries.length, message: "写入图库数据" });
    await writeAll(paths.metadataFile, entries);
    for (const fileName of [DATA_FILE_NAMES.tags, DATA_FILE_NAMES.albums, DATA_FILE_NAMES.people, DATA_FILE_NAMES.locations]) {
      await writeJsonlAtomic(path.join(paths.dataDir, fileName), []);
    }
    marker.Status = "committed";
    marker.Phase = "verify";
    marker.MediaCount = entries.length;
    marker.CommittedAt = new Date().toISOString();
    await writeTextAtomic(paths.initializationFile, `${JSON.stringify(marker, null, 2)}\n`);
    const parsed = await fsp.readFile(paths.metadataFile, "utf8");
    if (entries.length && !parsed.trim()) throw new Error("Metadata verification failed after initialization");
    await fsp.rm(paths.initializationFile, { force: true });
    emit({ phase: "complete", processed: entries.length, total: entries.length, message: "图库初始化完成" });
    return {
      ok: true,
      manifest,
      total: entries.length,
      images: entries.filter((item) => item.FileSystem.FileType === "image").length,
      videos: entries.filter((item) => item.FileSystem.FileType === "video").length,
      warnings,
      errors,
    };
  } catch (error) {
    if (lock) await releaseLibraryLock(paths, lock.SessionId).catch(() => {});
    lock = null;
    if (error.code === "OPERATION_CANCELLED" || cancelled) {
      await fsp.rm(paths.managerDir, { recursive: true, force: true });
      throw error;
    }
    if (fs.existsSync(paths.managerDir)) {
      await fsp.mkdir(paths.logDir, { recursive: true }).catch(() => {});
      const failure = `${new Date().toISOString()} initialization failed: ${error.stack || error.message}\n`;
      await fsp.writeFile(path.join(paths.logDir, "initialization-failed.log"), failure, "utf8").catch(() => {});
      await fsp.rm(paths.dataDir, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(paths.thumbnailDir, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(paths.backupDir, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(paths.tempDir, { recursive: true, force: true }).catch(() => {});
      marker.Status = "failed";
      marker.Phase = marker.Phase || "unknown";
      marker.FailedAt = new Date().toISOString();
      marker.Error = String(error.message).slice(0, 1000);
      await writeTextAtomic(paths.initializationFile, `${JSON.stringify(marker, null, 2)}\n`).catch(() => {});
    }
    throw error;
  } finally {
    if (lock) await releaseLibraryLock(paths, lock.SessionId).catch(() => {});
  }
}

if (require.main === module) {
  run({ logger: console }).then((result) => {
    console.log(`Initialized library: total=${result.total}, images=${result.images}, videos=${result.videos}, warnings=${result.warnings.length}`);
  }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { run };
