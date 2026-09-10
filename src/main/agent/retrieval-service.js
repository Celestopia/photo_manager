const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { fingerprint } = require("../../shared/agent-schema");
const { readGeneration, indexRows, INDEX_PROFILE } = require("./index-service");
const { projectMetadata } = require("./metadata-projection");
const { validateQueryPlan, evaluatePredicates, bm25, lexicalTokens } = require("./retrieval-domain");

function scanInWorker(payload, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "vector-search-worker.js"), { workerData: payload });
    let settled = false;
    function finish(error, result) {
      if (settled) return; settled = true;
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      error ? reject(error) : resolve(result);
    }
    const abort = () => finish(new Error("Search cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    worker.once("message", message => finish(message.error ? new Error(message.error) : null, message.result));
    worker.once("error", finish);
    worker.once("exit", () => { if (!settled) finish(new Error("Vector worker exited before completing")); });
  });
}

async function retrieve({ paths, items, registries, embeddings, plan, depth = 200, signal }) {
  validateQueryPlan(plan);
  if (!Number.isInteger(depth) || depth < 200 || depth > 10000) throw new Error("Invalid candidate depth");
  const generation = await readGeneration(paths, signal);
  const projected = new Map(items.map(item => [item.MediaId, projectMetadata(item, registries)]));
  const facts = new Map(items.map(item => [item.MediaId, evaluatePredicates(item, plan, registries)]));
  const eligible = items.filter(item => !facts.get(item.MediaId).excluded).map(item => ({ mediaId: item.MediaId,
    visualHash: fingerprint({ hash: item.SHA256Hash, profile: INDEX_PROFILE }), textHash: projected.get(item.MediaId).fingerprint }));
  const queries = {};
  if (plan.visualQuery) queries.visual = await embeddings.encode("visualText", [plan.visualQuery], signal);
  for (const [lane, field] of [["description", "descriptiveQuery"], ["context", "contextualQuery"]]) {
    if (plan[field]) queries[lane] = (await embeddings.encode("metadata", [plan[field]], signal))[0].map(chunk => chunk.vector);
  }
  const lanes = await scanInWorker({ generation, queries, eligible, depth }, signal);
  const lexical = bm25(eligible.map(item => ({ id: item.mediaId, text: projected.get(item.mediaId).description + "\n" + projected.get(item.mediaId).context })), [plan.descriptiveQuery, plan.contextualQuery].join(" "));
  lanes.lexical = [...lexical].filter(([, score]) => score > 0).map(([mediaId, score]) => ({ mediaId, score }))
    .sort((a, b) => b.score - a.score || a.mediaId.localeCompare(b.mediaId)).slice(0, depth);
  const scores = new Map(), weights = { visual: 0.5, description: 0.3, context: 0.15, lexical: 0.05 };
  for (const [lane, results] of Object.entries(lanes)) results.forEach((result, index) => {
    const entry = scores.get(result.mediaId) || { mediaId: result.mediaId, score: 0, lanes: {}, frames: [] };
    entry.score += weights[lane] / (61 + index); entry.lanes[lane] = result.score;
    if (lane === "visual") entry.frames = result.frames;
    scores.set(result.mediaId, entry);
  });
  const semantic = Boolean(plan.visualQuery || plan.descriptiveQuery || plan.contextualQuery);
  const exact = eligible.filter(item => facts.get(item.mediaId).evidence.some(e => e.state === "match"))
    .sort((a, b) => facts.get(b.mediaId).evidence.filter(e => e.state === "match").length - facts.get(a.mediaId).evidence.filter(e => e.state === "match").length || a.mediaId.localeCompare(b.mediaId));
  for (const item of (semantic ? exact.slice(0, depth) : eligible)) if (!scores.has(item.mediaId)) scores.set(item.mediaId, { mediaId: item.mediaId, score: 0, lanes: {}, frames: [] });
  const results = [...scores.values()].map(entry => {
    const fact = facts.get(entry.mediaId);
    const item=items.find(item=>item.MediaId===entry.mediaId);
    const assertions=[item.Customization.Title,item.Customization.Description,item.Customization.HiddenDescription,...item.Customization.TagIds.map(id=>registries.tags.get(id)?.Text||"")].join(" ");
    const concepts=lexicalTokens(plan.descriptiveQuery).filter(token=>!["a","an","the","of","photo","photos","image","images","picture","pictures","scenery"].includes(token));
    const assertionTokens=new Set(lexicalTokens(assertions));
    const metadataSupported=concepts.length>0&&concepts.every(token=>assertionTokens.has(token));
    return { ...entry, score: entry.score + Math.min(0.006, fact.preferred * 0.002), evidence: fact.evidence,
      group: fact.unknown ? "unknown" : semantic ? metadataSupported?"metadata-supported":"visual-candidates" : "matches" };
  }).sort((a, b) => Number(a.group === "unknown") - Number(b.group === "unknown") || b.score - a.score || a.mediaId.localeCompare(b.mediaId));
  return { results: semantic ? results.slice(0, depth * 3) : results, excluded: items.length - eligible.length,
    indexed: Boolean(generation), candidateDepth: depth, scopeCount: items.length,
    complete: false, notice: "Local similarity candidates are unverified; sampled media may omit relevant scenes." };
}
async function missingMetadata(paths, items, registries, signal) {
  const generation = await readGeneration(paths, signal), expected = new Map(), found = new Map();
  for (const item of items) {
    const projection = projectMetadata(item, registries);
    for (const lane of ["description", "context"]) if (projection[lane]) expected.set(`${item.MediaId}:${lane}`, projection.fingerprint);
  }
  for await (const { row } of indexRows(generation, signal)) {
    const key = `${row.mediaId}:${row.lane}`;
    if (row.lane === "visual" || expected.get(key) !== row.inputHash) continue;
    const document = found.get(key) || { count: row.expected, parts: new Set() };
    if (document.count !== row.expected) throw new Error("Inconsistent text chunk coverage");
    document.parts.add(row.part); found.set(key, document);
  }
  return [...new Set([...expected.keys()].filter(key => { const doc = found.get(key); return !doc || doc.parts.size !== doc.count; }).map(key => key.split(":")[0]))];
}
module.exports = { retrieve, scanInWorker, missingMetadata };
