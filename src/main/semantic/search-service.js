const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { createLocalEmbeddingService } = require("./local-embedding-service");
const { createModelAssets } = require("./model-assets");
function createSearchService({ modelsRoot, spawn }) {
  const embeddings = createLocalEmbeddingService(modelsRoot, { spawn }),
    models = createModelAssets(modelsRoot);
  let worker,
    serial = 0,
    tail = Promise.resolve(),
    validated = false,
    epoch = 0,
    draining = Promise.resolve();
  const pending = new Map();
  function clear() {
    const old = worker;
    worker = null;
    epoch++;
    if (old) draining = Promise.allSettled([draining, old.terminate()]);
    for (const p of pending.values()) p.reject(new Error("Search cancelled"));
    pending.clear();
    return draining;
  }
  async function encode(query, signal) {
    if (!validated) {
      if ((await models.status()).some((m) => !m.ready))
        throw new Error(
          "Embedding models are missing. Open Settings > Build Semantic Index to download or import them.",
        );
      validated = true;
    }
    const out = {};
    if (query.visualQuery)
      out.visual = await embeddings.encode(
        "visualText",
        [query.visualQuery],
        signal,
      );
    for (const [lane, key] of [
      ["description", "descriptiveQuery"],
      ["context", "contextualQuery"],
    ])
      if (query[key])
        out[lane] = (
          await embeddings.encode("metadata", [query[key]], signal)
        )[0].map((c) => c.vector);
    return out;
  }
  function rank(payload, signal) {
    const version = epoch;
    const task = tail.then(async () => {
      await draining;
      if (version !== epoch) throw new Error("Search cancelled");
      signal?.throwIfAborted();
      if (!worker) {
        const instance = new Worker(
          path.join(__dirname, "vector-search-worker.js"),
        );
        worker = instance;
        instance.on("message", (m) => {
          const p = pending.get(m.id);
          if (!p) return;
          pending.delete(m.id);
          m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
        });
        instance.on("error", () => {
          if (worker === instance) clear();
        });
        instance.on("exit", () => {
          if (worker === instance) clear();
        });
      }
      const id = ++serial;
      const promise = new Promise((resolve, reject) =>
        pending.set(id, { resolve, reject }),
      );
      signal?.addEventListener("abort", clear, { once: true });
      worker.postMessage({ id, payload });
      try {
        return await promise;
      } finally {
        signal?.removeEventListener("abort", clear);
      }
    });
    tail = task.catch(() => {});
    return task;
  }
  async function dispose() {
    validated = false;
    await Promise.all([clear(), embeddings.dispose()]);
  }
  return { encode, rank, dispose };
}
module.exports = { createSearchService };
