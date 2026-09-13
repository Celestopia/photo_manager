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
    replay: "explicit",
    description:
      "Find existing tags in this library. Query matches tag name or description. Use returned TagIds for proposals. Empty results mean no match; do not invent tags.",
    parameters: parameters({
      query: string,
      cursor: { type: ["string", "null"] },
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
      const revision = createHash("sha256")
        .update(JSON.stringify([a.query, tags]))
        .digest("hex");
      let offset = 0;
      if (a.cursor !== null) {
        const parts = a.cursor.split(":");
        offset = Number(parts[1]);
        if (
          parts.length !== 2 ||
          parts[0] !== revision ||
          !Number.isSafeInteger(offset) ||
          offset < 0
        )
          throw new AgentError(
            "resource_conflict",
            "Tags changed. Repeat the lookup with a null cursor.",
          );
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
            ? `${revision}:${offset + result.length}`
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
    description: `Prepare a ${name} suggestion for human review. Does not save metadata. ${name === "tags" ? "Only existing TagIds are allowed. Default to add unless removal or replacement is requested." : "An empty string proposes clearing this field."}`,
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
      } else str(a[name], max);
    },
    validateResult: validateProposalResult,
    execute: (a, ctx, call) => ctx.propose(field, a, call),
  })),
];
const metadataTools = createToolRegistry(definitions);
module.exports = { definitions, metadataTools };
