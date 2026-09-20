const { parentPort } = require("node:worker_threads");
const { readPointer, readIndex, readVectors } = require("./index-store");
const { profiles } = require("./domain");
let cached = null,
  rows = [];
async function rank({ paths, libraryId, queries, ids }) {
  const pointer = await readPointer(paths);
  if (!pointer)
    throw new Error(
      "No semantic index. Open Settings > Build Semantic Index first.",
    );
  const identity =
    paths.semanticDir + ":" + libraryId + ":" + pointer.generation;
  if (cached !== identity) {
    const index = await readIndex(paths, libraryId, pointer),
      next = [];
    let bytes = 0;
    for (const entry of index.entries) {
      const vectors = await readVectors(paths, entry);
      if (entry.profile === profiles[entry.lane]) {
        bytes += vectors.length * vectors[0].byteLength;
        next.push({
          entry,
          vectors: bytes <= 256 * 1024 * 1024 ? vectors : null,
        });
      }
    }
    rows = next;
    cached = identity;
  }
  const allowed = new Set(ids),
    lanes = { visual: new Map(), description: new Map(), context: new Map() };
  for (const row of rows) {
    const e = row.entry;
    if (!allowed.has(e.mediaId) || !queries[e.lane]?.length) continue;
    const vectors = row.vectors || (await readVectors(paths, e));
    let score = -Infinity;
    for (const v of vectors)
      for (const q of queries[e.lane]) {
        if (q.length !== v.length)
          throw new Error("Incompatible query dimension");
        let dot = 0;
        for (let i = 0; i < v.length; i++) dot += v[i] * q[i];
        score = Math.max(score, dot);
      }
    lanes[e.lane].set(e.mediaId, score);
  }
  const scores = new Map(),
    weights = { visual: 0.5, description: 0.3, context: 0.2 };
  for (const [lane, map] of Object.entries(lanes))
    [...map]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .forEach(([id], i) =>
        scores.set(id, (scores.get(id) || 0) + weights[lane] / (61 + i)),
      );
  return [...scores]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}
if (parentPort)
  parentPort.on("message", async ({ id, payload }) => {
    try {
      parentPort.postMessage({ id, result: await rank(payload) });
    } catch (e) {
      parentPort.postMessage({ id, error: e.message });
    }
  });
module.exports = { rank };
