const { groupMediaPathsByHash, countMediaTypes } = require("./media-summary");
const { assertMediaTechnicalFields } = require("../shared/media-technical-schema");
/** Initialize a new Photo Manager library. */
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
  writeJsonlAtomic,
  writeLibraryManifest,
  writeTextAtomic,
  findNestedManagerDirectory,
  findParentManagerDirectory,
} = require("./library-core");
const { acquireLibraryLock, releaseLibraryLock } = require("./library-lock");
const { validateMediaTools } = require("./media-tools");
const { createOperationReporter } = require("./operation-progress");
const {
  assertUuidV4,
  createUniqueEntityId,
} = require("../shared/identity-schema.js");
const { validateMediaEntries } = require("../shared/library-data-schema.js");

async function run(options = {}) {
  options.signal?.throwIfAborted();
  const config = options.config || resolveConfig();
  const paths = options.paths;
  const { emit, logger, warnings, errors } = createOperationReporter(options);
  let cancelled = Boolean(options.signal?.aborted);
  let lock = null;
  let ownsManager = false;
  let structureStarted = false;
  let marker;
  const cancel = () => { cancelled = true; };
  options.signal?.addEventListener("abort", cancel, { once: true });

  try {
    if (fs.existsSync(paths.managerDir)) throw new Error(`Library data already exists: ${paths.managerDir}`);
    const rootStat = await fsp.stat(paths.root).catch(() => null);
    if (!rootStat?.isDirectory()) throw new Error(`Library directory does not exist: ${paths.root}`);
    const rootLinkStat = await fsp.lstat(paths.root);
    if (rootLinkStat.isSymbolicLink()) throw new Error("A symbolic-link directory cannot be used as a library root");
    const parentManager = findParentManagerDirectory(paths.root);
    if (parentManager) throw new Error(`The selected directory is inside another Photo Manager library: ${parentManager}`);
    emit({ phase: "validate", message: "Validating library directory" });
    await assertDirectoryWritable(paths.root);
    const nested = await findNestedManagerDirectory(paths.root, ({ visited, current }) => {
      emit({ phase: "scan-directories", current, processed: visited });
    }, () => cancelled);
    if (nested) throw new Error(`Nested Photo Manager library detected: ${nested}`);
    await validateMediaTools(APP_ROOT, config.media);

    const manifest = createLibraryManifest(paths.root, options.name || path.basename(paths.root));
    marker = { Status: "initializing", StartedAt: new Date().toISOString(), Phase: "create-structure" };
    // mkdir without recursive is the cross-process ownership claim. A loser
    // must never write a manifest or clean up another attempt's contents.
    await fsp.mkdir(paths.managerDir);
    ownsManager = true;
    const claimedParent = findParentManagerDirectory(paths.root);
    if (claimedParent) throw new Error(`The selected directory is inside another Photo Manager library: ${claimedParent}`);
    const claimedNested = await findNestedManagerDirectory(paths.root, null, () => cancelled);
    if (claimedNested) throw new Error(`Nested Photo Manager library detected: ${claimedNested}`);
    if (cancelled) throw Object.assign(new Error("Initialization cancelled"), { code: "OPERATION_CANCELLED" });
    structureStarted = true;
    await ensureLibraryDirectories(paths);
    await writeLibraryManifest(paths, manifest);
    await writeTextAtomic(paths.initializationFile, `${JSON.stringify(marker, null, 2)}\n`);
    lock = await acquireLibraryLock(paths, manifest);
    emit({ phase: "scan", message: "Scanning media files" });
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
    let failed = 0;
    const usedEntityIds = new Set();
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
        const item = await buildMetadata(file, paths.root, { mediaConfig: config.media, signal: options.signal });
        if (item) {
          const id = assertUuidV4(item.MediaId, `MediaId for ${item.FilePath}`);
          if (usedEntityIds.has(id)) item.MediaId = createUniqueEntityId((candidate) => usedEntityIds.has(candidate));
          usedEntityIds.add(item.MediaId);
          entries.push(item);
        }
      } catch (error) {
        options.signal?.throwIfAborted();
        failed += 1;
        logger.warn(`Skip unreadable media: ${relative} (${error.message})`);
      }
    }

    const byHash = groupMediaPathsByHash(entries);
    for (const [hash, filePaths] of byHash) {
      if (filePaths.length > 1) logger.warn(`Duplicate SHA-256 ${hash}: ${filePaths.sort().join(", ")}`);
    }

    if (cancelled) throw Object.assign(new Error("Initialization cancelled"), { code: "OPERATION_CANCELLED" });
    entries.forEach(assertMediaTechnicalFields);
    validateMediaEntries(entries, {});

    emit({ phase: "write", processed: entries.length, total: entries.length, message: "Writing library data" });
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
    emit({ phase: "complete", processed: entries.length, total: entries.length, message: "Library initialization complete" });
    return {
      ok: true,
      manifest,
      total: entries.length,
      failed,
      ...countMediaTypes(entries),
      warnings,
      errors,
    };
  } catch (error) {
    if (!ownsManager) throw error;
    if (!structureStarted) {
      await fsp.rmdir(paths.managerDir);
      throw error;
    }
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
    options.signal?.removeEventListener("abort", cancel);
  }
}

module.exports = { run };
