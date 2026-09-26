const fs = require("node:fs");
const { formatLog } = require("./operation-log");
const { loadRegistryIndexes, validateMetadataMap } = require("./library-data");
/** Generate missing or all first-frame covers for one explicitly selected library. */
const path = require("node:path");
const { APP_ROOT, resolveConfig, loadExisting } = require("./common");
const { validateExistingLibrary, authorizeLibraryOperation, validateMetadataPaths } = require("./library-access");
const { assertLibraryReady } = require("./library-recovery");
const { createOperationReporter } = require("./operation-progress");
const { validateMediaTools, sanitizeMediaError } = require("./media-tools");
const cache = require("./video-cover-cache");

async function ensureVideoCovers(items, { paths, config, force = false, emit = () => {}, logger = console, signal,
  generate = cache.generateCover, validateTools = () => validateMediaTools(APP_ROOT, config.media) }) {
  await cache.assertCacheDirectory(paths, true);
  const groups = new Map();
  for (const item of items) {
    if (item.FileSystem?.FileType !== "video") continue;
    const group = groups.get(item.SHA256Hash) || [];
    group.push(item);
    groups.set(item.SHA256Hash, group);
  }
  const stats = { total: groups.size, generated: 0, skipped: 0, failed: 0, sourceChanged: 0 };
  const pending = new Set([...groups.keys()].filter(hash => force || !fs.existsSync(path.join(paths.videoCoverDir, cache.coverName(hash)))));
  const work = { id: 'generation', processed: 0, total: pending.size };
  let toolsValidated = false;
  for (const [hash, candidates] of groups) {
    signal?.throwIfAborted();
    let selected;
    let changed = false;
    let sourceFailure;
    for (const item of candidates) {
      const source = path.resolve(paths.root, item.FilePath);
      try {
        await cache.checkCoverSource(paths, item, source);
        selected = { item, source };
        break;
      } catch (error) {
        if (error.code === "SOURCE_CHANGED") changed = true;
        else if (error.code !== "ENOENT") throw error;
        if (!sourceFailure || error.code === "SOURCE_CHANGED") sourceFailure = { item, error };
      }
    }
    if (!selected) {
      if (changed) stats.sourceChanged++;
      else stats.failed++;
      logger.warn(formatLog("warning", "cover-source-unavailable", { path: sourceFailure.item.FilePath, stage: "source-check", code: sourceFailure.error.code, message: sourceFailure.error.message }));
    } else {
      const { item, source } = selected;
      let valid = false;
      if (!force) {
        try { await cache.checkExistingCover(path.join(paths.videoCoverDir, cache.coverName(hash))); valid = true; }
        catch (error) {
          if (["EACCES", "EPERM", "EIO"].includes(error.code)) throw error;
          if (error.code !== "ENOENT") logger.warn(formatLog("warning", "cover-cache-invalid", { path: item.FilePath, message: error.message, action: "regenerate" }));
        }
      }
      if (!valid && !pending.has(hash)) { pending.add(hash); work.total++; }
      if (!valid && !toolsValidated) {
        await validateTools();
        toolsValidated = true;
      }
      try {
        if (valid) {
          stats.skipped++;
        } else {
          await generate({ paths, source, hash, appRoot: APP_ROOT, config: config.media,
            signal,
            beforePublish: () => cache.checkCoverSource(paths, item, source) });
          stats.generated++;
        }
      } catch (error) {
        signal?.throwIfAborted();
        logger.warn(formatLog("warning", "cover-failed", { path: item.FilePath, stage: error.stage || "generate", code: error.code, message: sanitizeMediaError(error, source) }));
        if (["EACCES", "EPERM", "ENOSPC", "EROFS", "EIO"].includes(error.code)) throw error;
        if (error.code === "SOURCE_CHANGED") stats.sourceChanged++;
        else stats.failed++;
      }
    }
    if (pending.has(hash)) work.processed++;
    emit({ phase: "video-covers", estimateWork: [{ ...work }], processed: stats.generated + stats.skipped + stats.failed + stats.sourceChanged,
      ...stats, current: candidates[0].FilePath, message: "Generating video covers" });
  }
  signal?.throwIfAborted();
  emit({ phase: "complete", processed: stats.total, total: stats.total, message: "Video cover generation complete" });
  return stats;
}

async function run(options = {}) {
  options.signal?.throwIfAborted();
  const config = options.config || resolveConfig();
  const paths = options.paths;
  const { emit, logger, warnings, errors } = createOperationReporter({ ...options, logger: options.logger || console });
  const manifest = await validateExistingLibrary(paths, { onProgress: emit, signal: options.signal });
  const authorization = await authorizeLibraryOperation(paths, manifest, options);
  try {
    assertLibraryReady(paths);
    const existing = await loadExisting(paths.metadataFile);
    validateMetadataPaths(paths, existing.values());
    validateMetadataMap(existing, await loadRegistryIndexes(paths));
    const force = options.force ?? false;
    const stats = await ensureVideoCovers([...existing.values()], { paths, config, force, emit, logger, signal: options.signal });
    return { ...stats, force, warnings, errors };
  } finally { await authorization.release(); }
}
module.exports = { run, ensureVideoCovers };
