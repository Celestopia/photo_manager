const crypto = require("node:crypto");

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function createEntityId() {
  return crypto.randomUUID().toLowerCase();
}

function createUniqueEntityId(isUsed) {
  if (typeof isUsed !== "function") return createEntityId();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = createEntityId();
    if (!isUsed(id)) return id;
  }
  throw new Error("Unable to allocate a globally unique entity ID");
}

function isUuidV4(value) {
  return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

function assertUuidV4(value, context = "ID") {
  if (!isUuidV4(value)) throw new Error(`${context} must be a lowercase UUID v4`);
  return value;
}

function normalizeOptionalUuid(value) {
  return value === null || value === undefined || value === "" ? null : String(value).trim();
}

function assertOptionalUuidV4(value, context = "ID") {
  const normalized = normalizeOptionalUuid(value);
  if (normalized !== null) assertUuidV4(normalized, context);
  return normalized;
}

function assertUuidArray(value, context = "IDs") {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  const seen = new Set();
  for (const id of value) {
    assertUuidV4(id, `${context} entry`);
    if (seen.has(id)) throw new Error(`${context} contains duplicate ID: ${id}`);
    seen.add(id);
  }
  return value;
}

module.exports = {
  UUID_V4_PATTERN,
  createEntityId,
  createUniqueEntityId,
  isUuidV4,
  assertUuidV4,
  normalizeOptionalUuid,
  assertOptionalUuidV4,
  assertUuidArray,
};
