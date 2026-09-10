const path = require("node:path");
const { Worker } = require("node:worker_threads");
const manifest = require("./model-manifest.json");
function createLocalEmbeddingService(modelsRoot, { spawn } = {}) {
  let worker = null, serial = 0, tail = Promise.resolve();
  const pending = new Map();
  function stop() {
    const stopped = worker; worker = null;
    if (stopped) { stopped.kill?.(); stopped.terminate?.(); }
    for (const { reject } of pending.values()) reject(new Error("Embedding worker stopped"));
    pending.clear();
  }
  function ensure() {
    if (worker) return;
    const entry = path.join(__dirname, "embedding-worker.mjs");
    worker = spawn ? spawn(entry) : new Worker(entry);
    const instance = worker;
    worker.on("message", result => {
      const job = pending.get(result.id); if (!job) return;
      pending.delete(result.id); result.error ? job.reject(new Error(result.error)) : job.resolve(result.result);
    });
    const ended = () => { if (worker === instance) stop(); };
    worker.on("error", ended); worker.on("exit", ended);
  }
  function encode(kind, values, signal) {
    const task = tail.then(async () => {
      signal?.throwIfAborted(); ensure();
      const model = manifest.models.find(m => m.id === (kind === "metadata" ? "minilm" : "clip"));
      const id = ++serial;
      const promise = new Promise((resolve,reject) => pending.set(id,{resolve,reject}));
      const abort = () => stop(); signal?.addEventListener("abort",abort,{once:true});
      worker.postMessage({ id, kind, directory: path.join(modelsRoot, model.repository, model.revision), [kind === "image" ? "images" : "texts"]: values });
      try { return await promise; } finally { signal?.removeEventListener("abort",abort); }
    });
    tail = task.catch(() => {}); return task;
  }
  return { encode, dispose: stop };
}
module.exports = { createLocalEmbeddingService };
