/** Explicit, local-only semantic indexing; shares the application's library lock. */
const { APP_ROOT, resolveConfig, loadExisting } = require("./common");
const { parseLibraryArgument } = require("./library-core");
const { validateExistingLibrary, authorizeLibraryOperation, validateMetadataPaths } = require("./library-access");
const { loadRegistryIndexes, validateMetadataMap } = require("./library-data");
const { readTransactionJournal } = require("./library-transaction");
const { resolveApplicationPaths } = require("./application-paths");
const { createModelAssets } = require("../src/main/agent/model-assets");
const { createLocalEmbeddingService } = require("../src/main/agent/local-embedding-service");
const { buildIndex } = require("../src/main/agent/index-service");

async function main() {
  const paths = parseLibraryArgument();
  const manifest = await validateExistingLibrary(paths);
  const authorization = await authorizeLibraryOperation(paths, manifest);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  let embeddings;
  try {
    if (await readTransactionJournal(paths)) throw new Error("Open the library to recover its pending transaction first");
    const records = await loadExisting(paths.metadataFile);
    const indexes = await loadRegistryIndexes(paths);
    validateMetadataMap(records, indexes);
    const registries = Object.fromEntries(Object.entries(indexes).map(([key, value]) => [key, value.byId]));
    validateMetadataPaths(paths, records.values());
    const modelsRoot = resolveApplicationPaths().agentModelsDir;
    const status = await createModelAssets(modelsRoot).status();
    if (!status.every(model => model.ready)) throw new Error("Install the pinned local models with agent-models.js --download first");
    embeddings = createLocalEmbeddingService(modelsRoot);
    let last = 0;
    const result = await buildIndex({ paths, items: [...records.values()], registries, embeddings,
      kind: process.argv.includes("--rebuild") ? "rebuild" : "update",
      resourceRoot: APP_ROOT, mediaConfig: resolveConfig().media, signal: controller.signal,
      onProgress(progress) { if (Date.now() - last > 5000) { console.log(JSON.stringify(progress)); last = Date.now(); } },
    });
    console.log(JSON.stringify(result));
  } finally {
    embeddings?.dispose();
    process.removeListener("SIGINT", cancel);
    await authorization.release();
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
