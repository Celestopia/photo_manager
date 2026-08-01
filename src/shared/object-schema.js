function assertExactObjectKeys(value, allowedFields, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length) throw new Error(`${context} contains unsupported field: ${unknown.join(", ")}`);
  return value;
}

module.exports = { assertExactObjectKeys };
