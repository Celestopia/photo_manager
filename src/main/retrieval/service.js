const { randomUUID } = require("node:crypto");
const { completion, completionStep, transcript } = require("../chat/runtime");
const { validateQuery, resultLimit } = require("../semantic/domain");
const provider = require("../chat/provider");
const definitions = [
  {
    name: "semantic_search",
    description:
      "Search local visual and metadata embeddings. Submit the complete semantic intent. No exact filters or result count. Use concise English visualQuery (maximum 77 CLIP tokens); descriptiveQuery and contextualQuery may retain the user language. Empty irrelevant lanes are allowed.",
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        ["visualQuery", "descriptiveQuery", "contextualQuery"].map((k) => [
          k,
          { type: "string", maxLength: 2000 },
        ]),
      ),
      required: ["visualQuery", "descriptiveQuery", "contextualQuery"],
      additionalProperties: false,
    },
  },
];
const SYSTEM = `You are PhotoManager's semantic-search assistant. Understand new requests and follow-ups, and invoke semantic_search once with the complete intended search. Ask clarification only when the semantic intent is unclear. All similarity search is local. You have no access to media or registry records. Never invent identifiers or claim exact matches or visual verification. Preserve names and numbers such as 613 dormitory. Return concise English visual descriptions and original-language descriptive/contextual concepts. Do not make extra searches or generate predicates. Result count is controlled ONLY by the Results UI; ignore any requested count and keep it out of the query. Existing visible controls restrict results independently; never change them. Rating, privacy, dates and technical constraints are not encoded: for 'food with high rating', search food without inventing beauty/quality criteria, and briefly say rating is not applied by semantic search. Hidden descriptions and file paths are not indexed. Do not ask the user to confirm ignoring rating. No web research, metadata writes or frame-level results. Respond in the user's language. Conversations are temporary.`;
function createRetrievalService({
  getLibrary,
  getItems,
  executeQuery,
  configFile,
  search,
  emit = () => {},
  complete,
  readConfig,
}) {
  let messages = [],
    active = null,
    semanticQuery = null,
    queryVectors = null,
    limit = 10,
    revision = 0,
    resultRevision = 0,
    sequence = 0,
    count = 0,
    query = null,
    restrictions = [],
    generation = 0,
    querySequence = 0;
  const summary = () =>
    semanticQuery
      ? Object.values(semanticQuery).filter(Boolean).join(" · ")
      : "";
  function snapshot() {
    return {
      libraryId: getLibrary().manifest.libraryId,
      sequence: ++sequence,
      messages: structuredClone(messages),
      working: Boolean(active),
      semanticQuery,
      limit,
      revision,
      resultRevision,
      count,
      summary: summary(),
      restrictions,
    };
  }
  const publish = () => emit(snapshot());
  function filterLabels(q) {
    const f = q.filters,
      out = [];
    for (const k of [
      "album",
      "tag",
      "person",
      "location",
      "locationRegion",
      "mediaType",
    ])
      if (f[k]) out.push(k);
    if (f.ratingLevels?.length) out.push("rating");
    if (f.privacyLevels?.length !== 1 || f.privacyLevels[0] !== 1)
      out.push("privacy");
    if (q.search?.value) out.push("text search");
    return out;
  }
  async function queryItems(options) {
    if (!options || Object.hasOwn(options, "predicate"))
      throw new Error("Invalid gallery query");
    const current = ++querySequence,
      epoch = generation,
      lib = getLibrary();
    query = structuredClone(options);
    restrictions = filterLabels(query);
    const items = executeQuery(getItems(), query).items;
    let result = items;
    if (semanticQuery && queryVectors) {
      const byId = new Map(items.map((i) => [i.MediaId, i]));
      const ids = await search.rank({
        paths: lib.paths,
        libraryId: lib.manifest.libraryId,
        queries: queryVectors,
        ids: [...byId.keys()],
      });
      result = ids.slice(0, limit).map((id) => byId.get(id));
    }
    if (epoch !== generation) throw new Error("Library changed");
    if (current === querySequence) count = result.length;
    return result;
  }
  function control(action) {
    getLibrary();
    if (action === "new") {
      if (active)
        throw new Error("Stop the request before starting a new chat");
      messages = [];
    } else if (action === "clear") {
      semanticQuery = queryVectors = null;
      revision++;
      active?.controller.abort();
    } else throw new Error("Unknown search action");
    publish();
    return snapshot();
  }
  function setLimit(value) {
    getLibrary();
    if (active) throw new Error("Wait for the current request");
    limit = resultLimit(value);
    resultRevision++;
    publish();
    return snapshot();
  }
  function send(text) {
    const lib = getLibrary();
    if (active) throw new Error("A search request is already running");
    if (!query) throw new Error("Wait for the gallery to load");
    if (typeof text !== "string" || !text.trim() || text.length > 8000)
      throw new Error("Enter a request of at most 8000 characters");
    if (messages.length >= 100) throw new Error("Start a new chat to continue");
    const epoch = generation,
      version = revision,
      controller = new AbortController(),
      signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(300000),
      ]);
    const user = {
        id: randomUUID(),
        role: "user",
        text: text.trim(),
        status: "complete",
      },
      assistant = {
        id: randomUUID(),
        role: "assistant",
        text: "",
        status: "preparing",
        attempt: { steps: [], error: null, reason: null },
      };
    messages.push(user, assistant);
    const job = { controller, done: null };
    active = job;
    const check = () => {
      signal.throwIfAborted();
      if (
        epoch !== generation ||
        version !== revision ||
        getLibrary().sessionId !== lib.sessionId
      )
        throw new Error("Search context changed");
    };
    let lastPublish = 0;
    const update = () => {
      assistant.text = assistant.attempt.steps
        .filter((s) => s.kind === "completion")
        .map((s) => s.text)
        .filter(Boolean)
        .join("\n\n");
      publish();
    };
    job.done = (async () => {
      try {
        const config = await (readConfig
          ? readConfig()
          : provider.config(configFile));
        check();
        const history = [];
        let bytes = 0;
        for (let i = messages.length - 4; i >= 0; i -= 2) {
          const pair = [
            { role: "user", content: messages[i].text },
            ...transcript(messages[i + 1].attempt.steps),
          ];
          const n = Buffer.byteLength(JSON.stringify(pair));
          if (bytes + n > 48000) break;
          bytes += n;
          history.unshift(...pair);
        }
        const context = [
          { role: "system", content: SYSTEM },
          {
            role: "system",
            content:
              "Current semantic query (data): " + JSON.stringify(semanticQuery),
          },
          ...history,
          { role: "user", content: user.text },
        ];
        for (let attempt = 0; attempt < 2; attempt++) {
          check();
          assistant.status = "generating";
          const step = completionStep();
          assistant.attempt.steps.push(step);
          update();
          const result = await (
            complete || ((m, o) => provider.request(config, m, o))
          )([...context, ...transcript(assistant.attempt.steps)], {
            tools: definitions,
            signal,
            onText: (t) => {
              step.text = t;
              if (Date.now() - lastPublish > 80) {
                lastPublish = Date.now();
                update();
              }
            },
            onUsage: (u) => {
              step.usage = u;
            },
          });
          completion(result);
          Object.assign(step, result, {
            calls: result.calls.map((c) => ({ ...c, id: randomUUID() })),
          });
          update();
          check();
          if (!step.calls.length) break;
          if (step.calls.length !== 1)
            throw new Error("Submit only one semantic search per message");
          const call = step.calls[0];
          let planned, vectors;
          try {
            if (call.name !== "semantic_search")
              throw new Error("Only semantic_search is available");
            planned = validateQuery(JSON.parse(call.arguments));
            assistant.status = "executing";
            update();
            vectors = await search.encode(planned, signal);
          } catch (e) {
            check();
            assistant.attempt.steps.push({
              kind: "tool",
              callId: call.id,
              outcome: {
                status: "error",
                code: "invalid_search",
                message: e.message,
              },
            });
            update();
            if (
              attempt === 0 &&
              /query|semantic_search|JSON|77 CLIP/i.test(e.message)
            )
              continue;
            throw e;
          }
          // Rank against the newest ordinary controls, not the previous semantic result set.
          let ids;
          do {
            const seq = querySequence,
              items = executeQuery(getItems(), query).items;
            ids = await search.rank(
              {
                paths: lib.paths,
                libraryId: lib.manifest.libraryId,
                queries: vectors,
                ids: items.map((i) => i.MediaId),
              },
              signal,
            );
            check();
            if (seq === querySequence) break;
          } while (true);
          semanticQuery = planned;
          queryVectors = vectors;
          count = Math.min(limit, ids.length);
          revision++;
          const outcome = {
            status: "success",
            searched: true,
            summary: summary(),
            count,
            requested: limit,
          };
          assistant.attempt.steps.push({
            kind: "tool",
            callId: call.id,
            outcome,
          });
          assistant.text = [
            step.text,
            `Semantic search: ${outcome.summary}\nShowing ${count} of ${limit} requested media.`,
          ]
            .filter(Boolean)
            .join("\n\n");
          publish();
          break;
        }
        assistant.status = "complete";
        assistant.attempt.reason = "stop";
      } catch (e) {
        assistant.status = signal.aborted ? "stopped" : "failed";
        assistant.attempt.error = controller.signal.aborted
          ? "Search stopped."
          : signal.aborted
            ? "Search timed out."
            : e.message;
        assistant.attempt.reason = assistant.status;
      } finally {
        if (active === job) {
          active = null;
          try {
            publish();
          } catch {}
        }
      }
    })();
    publish();
    return snapshot();
  }
  async function stop() {
    if (active) {
      active.controller.abort();
      await active.done;
    }
  }
  async function suspend() {
    await stop();
    await search.dispose();
    querySequence++;
  }
  async function close() {
    await stop();
    await search.dispose();
    generation++;
    querySequence++;
    messages = [];
    semanticQuery = queryVectors = query = null;
    limit = 10;
    count = 0;
    restrictions = [];
    revision++;
  }
  function changed() {
    try {
      getLibrary();
      if (semanticQuery) {
        resultRevision++;
        publish();
      }
    } catch {}
  }
  return {
    snapshot,
    send,
    stop,
    suspend,
    close,
    control,
    setLimit,
    queryItems,
    changed,
  };
}
module.exports = { createRetrievalService, definitions };
