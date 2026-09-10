const crypto = require("node:crypto");
const { assertExactObjectKeys } = require("./object-schema");
const { assertUuidV4, assertUuidArray } = require("./identity-schema");

function exact(value, fields, required = fields, label = "Agent payload") {
  assertExactObjectKeys(value, fields, label);
  for (const field of required) if (!Object.hasOwn(value, field)) throw new Error(`${label}.${field} is required`);
  return value;
}
function text(value, limit = 16000, label = "Text") {
  if (typeof value !== "string" || [...value].length > limit) throw new Error(`${label} must be text up to ${limit} characters`);
  return value;
}
function ids(value, limit = 10000) {
  assertUuidArray(value, "MediaIds");
  if (value.length > limit) throw new Error(`At most ${limit} items are allowed`);
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function fingerprint(value) { return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function assertAgentPatch(patch, tags) {
  exact(patch, ["Title", "Description", "TagIds"], [], "Agent patch");
  if (Object.hasOwn(patch, "Title")) text(patch.Title, 512, "Title");
  if (Object.hasOwn(patch, "Description")) text(patch.Description, 8000, "Description");
  if (Object.hasOwn(patch, "TagIds")) {
    ids(patch.TagIds, 1000);
    if (tags && patch.TagIds.some(id => !tags.has(id))) throw new Error("Unknown tag reference");
  }
  return patch;
}
const METADATA_GROUPS = Object.freeze(["basic", "hidden", "people", "location", "technical"]);
function groups(value) {
  if (!Array.isArray(value) || new Set(value).size !== value.length || value.some(g => !METADATA_GROUPS.includes(g))) throw new Error("Invalid metadata groups");
  return value;
}
module.exports = { exact, text, ids, groups, fingerprint, assertAgentPatch, assertUuidV4, METADATA_GROUPS };
