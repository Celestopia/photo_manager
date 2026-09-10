const { chatCompletion } = require("./providers/chat-completions");
const { validateQueryPlan } = require("./retrieval-domain");
const { text } = require("../../shared/agent-schema");

// Deliberately accepts no library context. This provider cannot read local data.
async function planQuery({ query, profile, budget, signal }) {
  text(query, 4000, "Search query");
  const result = await chatCompletion(profile, {
    messages: [
      { role: "system", content: `Translate a media search request into JSON only, without Markdown. Output exactly visualQuery (short English scene description; empty for exact-only queries), descriptiveQuery (descriptive concepts), contextualQuery (place/person context), predicates (boolean tree, maximum 12 leaves and depth 3). A branch is exactly {all:[nodes]} or {any:[nodes]}; no conditions is {all:[]}. A leaf has exactly field, operator, value, policy, source. Fields: type (image/video), title, description, tag, person, album, location (name or UUID), date (ISO year/month/date/instant), rating, privacy, duration (seconds), gps. Operators: eq, in (array), range (inclusive two-element array), contains, not (exclusion). Numeric fields require numbers. GPS value is {latitude,longitude,radiusKm}, with eq or not only. Policy is required/ordinary/preferred. Source is the exact user-text span establishing the condition. Location/date default ordinary; explicit only is required; prefer is preferred; exclusions use not and required. Scene concepts should be lane queries, not mandatory registered tags. Do not invent registry identities. Use names from the query. Unsupported conditions must be reported by returning {"unsupported":"reason"}; never silently drop them. You have no access to a library.` },
      { role: "user", content: query },
    ], budget, signal, stream: false, maxTokens: 1800,
  });
  const plan = JSON.parse(result.content);
  if (plan.unsupported) throw new Error(`Unsupported search condition: ${String(plan.unsupported).slice(0, 300)}`);
  validateQueryPlan(plan);
  function checkSources(node) { if (node.all || node.any) return (node.all || node.any).forEach(checkSources); if (!query.includes(node.source)) throw new Error("A query condition is not supported by the typed request"); }
  checkSources(plan.predicates);
  return plan;
}
module.exports = { planQuery };
