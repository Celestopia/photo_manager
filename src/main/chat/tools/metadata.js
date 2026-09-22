const { createHash } = require("node:crypto");
const { exact, str, uuid, AgentError } = require("../runtime");
const { createToolRegistry } = require("./registry");
const string = { type: "string" };
const mediaId = {
  type: "string",
  description: "MediaId from the authorized target catalog.",
};
function parameters(properties) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
function validateProposalResult(v) {
  if (v.status === "no_change") {
    exact(v, ["status"]);
    return;
  }
  exact(v, ["status", "proposalId"]);
  uuid(v.proposalId);
  if (v.status !== "proposal_created")
    throw new Error("Invalid proposal result");
}
const definitions = [
  {
    name: "find_library_tags",
    contractVersion: 1,
    effect: "read",
    maxFailuresPerTurn: 2,
    replay: "explicit",
    description:
      "Find existing tags only when the user requests tag lookup or tag suggestions/changes, not ordinary image discussion. Query matches name or description. Start with cursor null; use a returned cursor unchanged only with the exact same query. Empty results mean no match; do not invent tags.",
    parameters: parameters({
      query: { type: "string", description: "Tag name or description search; keep identical while paging." },
      cursor: { type: ["string", "null"], description: "null for a new query or one corrected retry; otherwise the exact cursor returned for this query." },
    }),
    available: (scope) => scope.groups.basic && scope.mediaIds.length > 0,
    validate(a) {
      exact(a, ["query", "cursor"]);
      str(a.query, 500);
      if (a.cursor !== null) str(a.cursor, 200);
    },
    validateResult(v) {
      exact(v, ["status", "tags", "cursor"]);
      if (
        v.status !== "success" ||
        !Array.isArray(v.tags) ||
        v.tags.length > 50
      )
        throw new Error("Invalid tag results");
      if (v.cursor !== null) str(v.cursor, 200);
      for (const t of v.tags) {
        exact(t, ["TagId", "Text", "Description"]);
        uuid(t.TagId);
        str(t.Text, 1000);
        str(t.Description, 2000);
      }
    },
    async execute(a, ctx) {
      const tags = ctx
        .tags()
        .map((t) => ({
          TagId: t.TagId,
          Text: t.Text,
          Description: t.Description,
        }));
      tags.sort(
        (a, b) =>
          a.Text.localeCompare(b.Text, "en-US") ||
          a.TagId.localeCompare(b.TagId),
      );
      const queryHash = createHash("sha256").update(a.query).digest("hex");
      const revision = createHash("sha256")
        .update(JSON.stringify(tags))
        .digest("hex");
      let offset = 0;
      if (a.cursor !== null) {
        const parts = a.cursor.split(":");
        offset = Number(parts[2]);
        if (parts.length !== 3 || !/^[a-f0-9]{64}$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1]) || !/^[1-9][0-9]*$/.test(parts[2]) || !Number.isSafeInteger(offset))
          throw new AgentError("invalid_cursor", "Invalid tag lookup cursor. Retry once with cursor null; copy returned cursors exactly.");
        if (parts[0] !== queryHash)
          throw new AgentError("cursor_query_mismatch", "This cursor belongs to a different query. Retry once with cursor null.");
        if (parts[1] !== revision)
          throw new AgentError("resource_conflict", "The tag registry changed since this page was read. Retry once with cursor null.");
      }
      const q = a.query.toLocaleLowerCase("en-US");
      const matches = tags.filter((t) =>
        (t.Text + " " + t.Description).toLocaleLowerCase("en-US").includes(q),
      );
      const result = [];
      for (const t of matches.slice(offset, offset + 50)) {
        const next = {
          ...t,
          Text: t.Text.slice(0, 1000),
          Description: t.Description.slice(0, 2000),
        };
        if (
          result.length &&
          Buffer.byteLength(JSON.stringify([...result, next])) > 14000
        )
          break;
        result.push(next);
      }
      return {
        status: "success",
        tags: result,
        cursor:
          offset + result.length < matches.length
            ? `${queryHash}:${revision}:${offset + result.length}`
            : null,
      };
    },
  },
  ...[
    ["title", "Title", 2000],
    ["description", "Description", 20000],
    ["tags", "TagIds", 50],
  ].map(([name, field, max]) => ({
    name: `propose_${name}`,
    contractVersion: 1,
    effect: "proposal",
    replay: "local-call-id",
    description: `Only when the user explicitly requests ${name} metadata suggestions or changes (including clear follow-ups), prepare a ${name} suggestion for human review. Do not use for ordinary image questions or requests about other metadata fields. Does not save metadata. ${name === "tags" ? "Only existing TagIds are allowed. Default to add unless removal or replacement is requested." : "An empty string proposes clearing this field."}`,
    parameters: parameters(
      name === "tags"
        ? {
            mediaId,
            operation: { type: "string", enum: ["add", "remove", "replace"] },
            tagIds: { type: "array", items: string, maxItems: max },
          }
        : { mediaId, [name]: { type: "string", maxLength: max } },
    ),
    available: (scope) =>
      scope.mediaIds.length > 0 && (name !== "tags" || scope.groups.basic),
    validate(a) {
      exact(
        a,
        name === "tags"
          ? ["mediaId", "operation", "tagIds"]
          : ["mediaId", name],
      );
      uuid(a.mediaId);
      if (name === "tags") {
        if (
          !["add", "remove", "replace"].includes(a.operation) ||
          !Array.isArray(a.tagIds) ||
          a.tagIds.length > max
        )
          throw new Error("Invalid tag operation");
        a.tagIds.forEach(uuid);
      } else {
        str(a[name], max);
        if (/\[source:/i.test(a[name])) throw new Error('Keep source citations in the explanation, not metadata values');
      }
    },
    validateResult: validateProposalResult,
    execute: (a, ctx, call) => ctx.propose(field, a, call),
  })),
];
const metadataTools = createToolRegistry(definitions);
module.exports = { definitions, metadataTools };
