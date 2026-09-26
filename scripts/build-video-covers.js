const { loadRegistryIndexes, validateMetadataMap } = require("./library-data");
/** Generate missing or all first-frame covers for one explicitly selected library. */
const path = require("node:path");
const { APP_ROOT, resolveConfig, loadExisting } = require("./common");
const { parseLibraryArgument } = require("./library-core");
const { validateExistingLibrary, authorizeLibraryOperation, validateMetadataPaths } = require("./library-access");
const { assertLibraryReady } = require("./library-recovery");
const { createOperationReporter } = require("./operation-progress");
const { validateMediaTools } = require("./media-tools");
const cache = require("./video-cover-cache");

async function ensureVideoCovers(items, { paths, config, force = false, emit = () => {}, logger = console,
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
  let toolsValidated = false;
  for (const [hash, candidates] of groups) {
    let selected;
    let changed = false;
    for (const item of candidates) {
      const source = path.resolve(paths.root, item.FilePath);
      try {
        await cache.checkCoverSource(paths, item, source);
        selected = { item, source };
        break;
      } catch (error) {
        if (error.code === "SOURCE_CHANGED") changed = true;
        else if (error.code !== "ENOENT") throw error;
      }
    }
    if (!selected) {
      if (changed) stats.sourceChanged++;
      else stats.failed++;
      logger.warn(`Cover skipped: ${candidates[0].FilePath}; source missing or changed. Update Metadata before retrying.`);
    } else {
      const { item, source } = selected;
      let valid = false;
      if (!force) {
        try { await cache.checkExistingCover(path.join(paths.videoCoverDir, cache.coverName(hash))); valid = true; }
        catch (error) {
          if (["EACCES", "EPERM", "EIO"].includes(error.code)) throw error;
        }
      }
      if (!valid && !toolsValidated) {
        await validateTools();
        toolsValidated = true;
      }
      try {
        if (valid) {
          stats.skipped++;
        } else {
          await generate({ paths, source, hash, appRoot: APP_ROOT, config: config.media,
            beforePublish: () => cache.checkCoverSource(paths, item, source) });
          stats.generated++;
        }
      } catch (error) {
        if (["EACCES", "EPERM", "ENOSPC", "EROFS", "EIO"].includes(error.code)) throw error;
        if (error.code === "SOURCE_CHANGED") stats.sourceChanged++;
        else stats.failed++;
        logger.warn(`Cover unavailable: ${item.FilePath}${error.code === "SOURCE_CHANGED" ? "; update metadata" : ""}`);
      }
    }
    emit({ phase: "video-covers", processed: stats.generated + stats.skipped + stats.failed + stats.sourceChanged,
      total: stats.total, current: candidates[0].FilePath, message: "Generating video covers" });
  }
  emit({ phase: "complete", processed: stats.total, total: stats.total, message: "Video cover generation complete" });
  return stats;
}

async function run(options = {}) {
  const config = options.config || resolveConfig();
  const paths = options.paths || parseLibraryArgument();
  const { emit, logger, warnings, errors } = createOperationReporter({ ...options, logger: options.logger || console });
  const manifest = await validateExistingLibrary(paths, { onProgress: emit });
  const authorization = await authorizeLibraryOperation(paths, manifest, options);
  try {
    assertLibraryReady(paths);
    const existing = await loadExisting(paths.metadataFile);
    validateMetadataPaths(paths, existing.values());
    validateMetadataMap(existing, await loadRegistryIndexes(paths));
    const force = options.force ?? process.argv.includes("--force");
    const stats = await ensureVideoCovers([...existing.values()], { paths, config, force, emit, logger });
    return { ...stats, force, warnings, errors };
  } finally { await authorization.release(); }
}
if (require.main === module) run().then(stats => console.log(JSON.stringify(stats, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run, ensureVideoCovers };
