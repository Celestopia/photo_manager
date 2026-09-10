/** Offline semantic search diagnostic. Requires an explicit library and English visual query. */
const { parseLibraryArgument } = require("./library-core");
const { validateExistingLibrary, authorizeLibraryOperation, validateMetadataPaths } = require("./library-access");
const { loadExisting } = require("./common");
const { loadRegistryIndexes, validateMetadataMap } = require("./library-data");
const { readTransactionJournal } = require("./library-transaction");
const { resolveApplicationPaths } = require("./application-paths");
const { createLocalEmbeddingService } = require("../src/main/agent/local-embedding-service");
const { retrieve } = require("../src/main/agent/retrieval-service");
async function main() {
  const paths = parseLibraryArgument(), query = process.argv[process.argv.indexOf("--query") + 1];
  if (!process.argv.includes("--query") || !query?.trim()) throw new Error("Pass --library and --query");
  const manifest = await validateExistingLibrary(paths), authorization = await authorizeLibraryOperation(paths, manifest);
  const embeddings = createLocalEmbeddingService(resolveApplicationPaths().agentModelsDir);
  try {
    if (await readTransactionJournal(paths)) throw new Error("Recover the pending transaction by opening the library first");
    const records = await loadExisting(paths.metadataFile), indexes = await loadRegistryIndexes(paths);
    validateMetadataMap(records, indexes); validateMetadataPaths(paths, records.values());
    const registries = Object.fromEntries(Object.entries(indexes).map(([key, value]) => [key, value.byId]));
    const started = Date.now();
    const result = await retrieve({ paths, items: [...records.values()], registries, embeddings, plan: { visualQuery: query, descriptiveQuery: query, contextualQuery: query, predicates: { all: [] } } });
    console.log(JSON.stringify({ milliseconds: Date.now() - started, scope: result.scopeCount, candidates: result.results.length, topMediaIds: result.results.slice(0, 10).map(item => item.mediaId), groups: Object.fromEntries([...new Set(result.results.map(item => item.group))].map(group => [group, result.results.filter(item => item.group === group).length])) }));
  } finally { embeddings.dispose(); await authorization.release(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
