const { parentPort, workerData } = require("node:worker_threads");
const { indexRows } = require("./index-service");

async function scan({ generation, queries, eligible, depth = 200 }) {
  const allowed = new Map(eligible.map(item => [item.mediaId, item]));
  const lanes = { visual: new Map(), description: new Map(), context: new Map() };
  for await (const { row, vector } of indexRows(generation)) {
    const item = allowed.get(row.mediaId), query = queries[row.lane];
    if (!item || !query?.length || row.inputHash !== item[row.lane === "visual" ? "visualHash" : "textHash"]) continue;
    if (query.some(q => q.length !== vector.length)) throw new Error("Query dimension does not match the index");
    let score = -Infinity;
    for (const q of query) {
      let dot = 0;
      for (let i = 0; i < vector.length; i++) dot += q[i] * vector[i];
      score = Math.max(score, dot);
    }
    const lane = lanes[row.lane];
    const existing = lane.get(row.mediaId) || { mediaId: row.mediaId, score: -Infinity, frames: [] };
    existing.score = Math.max(existing.score, score);
    if (row.lane === "visual" && row.timestamp !== null) {
      existing.frames.push({ timestamp: row.timestamp, score });
      existing.frames.sort((a, b) => b.score - a.score || a.timestamp - b.timestamp);
      existing.frames = existing.frames.slice(0, 4);
    }
    lane.set(row.mediaId, existing);
  }
  return Object.fromEntries(Object.entries(lanes).map(([name, values]) => [name, [...values.values()]
    .sort((a, b) => b.score - a.score || a.mediaId.localeCompare(b.mediaId)).slice(0, depth)]));
}
if (parentPort) scan(workerData).then(result => parentPort.postMessage({ result }), error => parentPort.postMessage({ error: error.message }));
module.exports = { scan };
