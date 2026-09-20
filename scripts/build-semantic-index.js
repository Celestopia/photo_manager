const { resolveApplicationPaths } = require("./application-paths");
const { parseLibraryArgument } = require("./library-core");
const { loadRegistryIndexes, validateMetadataMap } = require("./library-data");
const { APP_ROOT, resolveConfig, loadExisting } = require("./common");
const {
  validateExistingLibrary,
  authorizeLibraryOperation,
  validateMetadataPaths,
} = require("./library-access");
const { assertLibraryReady } = require("./library-recovery");
const { createOperationReporter } = require("./operation-progress");
const { createModelAssets } = require("../src/main/semantic/model-assets");
const {
  createLocalEmbeddingService,
} = require("../src/main/semantic/local-embedding-service");
const { buildIndex } = require("../src/main/semantic/index-builder");
// Persistence validators return registry bundles; semantic projection consumes ID maps.
async function loadIndexInputs(paths) {
  const records = await loadExisting(paths.metadataFile);
  const indexes = await loadRegistryIndexes(paths);
  validateMetadataPaths(paths, records.values());
  validateMetadataMap(records, indexes);
  return {
    items: [...records.values()],
    registries: {
      tags: indexes.tags.byId,
      albums: indexes.albums.byId,
      people: indexes.people.byId,
      locations: indexes.locations.byId,
    },
  };
}

async function run(options = {}) {
  const paths = options.paths || parseLibraryArgument(),
    config = options.config || resolveConfig();
  const manifest = await validateExistingLibrary(paths),
    authorization = await authorizeLibraryOperation(paths, manifest, options),
    controller = new AbortController();
  const cancel = (m) => {
    if (m?.type === "cancel") controller.abort();
  };
  process.on("message", cancel);
  const embeddings = createLocalEmbeddingService(
    resolveApplicationPaths().modelsDir,
  );
  try {
    assertLibraryReady(paths);
    const models = createModelAssets(resolveApplicationPaths().modelsDir);
    if ((await models.status()).some((m) => !m.ready))
      throw new Error(
        "Download or import embedding models in Build Semantic Index first",
      );
    const inputs = await loadIndexInputs(paths);
    const { emit } = createOperationReporter(options);
    return await buildIndex({
      paths,
      libraryId: manifest.libraryId,
      ...inputs,
      embeddings,
      signal: controller.signal,
      force: options.force ?? process.argv.includes("--force"),
      resourceRoot: APP_ROOT,
      mediaConfig: config.media,
      onProgress: emit,
    });
  } finally {
    process.removeListener("message", cancel);
    await embeddings.dispose();
    await authorization.release();
  }
}
if (require.main === module)
  run()
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
module.exports = { run, loadIndexInputs };
