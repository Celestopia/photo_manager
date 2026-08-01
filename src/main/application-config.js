const fs = require("node:fs");
const yaml = require("js-yaml");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeKnownShape(defaultValue, candidate) {
  if (!isPlainObject(defaultValue)) return candidate === undefined ? defaultValue : candidate;
  const source = isPlainObject(candidate) ? candidate : {};
  return Object.fromEntries(
    Object.entries(defaultValue).map(([key, value]) => [key, mergeKnownShape(value, source[key])]),
  );
}

function normalizeConfig(parsed, defaults, normalizeMediaConfig) {
  return {
    thumbnail: mergeKnownShape(defaults.thumbnail, parsed?.thumbnail),
    media: normalizeMediaConfig(parsed?.media),
    backup: {
      retentionCount: Math.max(1, Math.trunc(Number(parsed?.backup?.retentionCount) || defaults.backup.retentionCount)),
    },
    ui: mergeKnownShape(defaults.ui, parsed?.ui),
  };
}

function loadConfig(configPath, defaults, normalizeMediaConfig) {
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, yaml.dump(defaults), "utf8");
    return { config: structuredClone(defaults), warning: "" };
  }

  try {
    const parsed = yaml.load(fs.readFileSync(configPath, "utf8"));
    return { config: normalizeConfig(parsed, defaults, normalizeMediaConfig), warning: "" };
  } catch (error) {
    return {
      config: structuredClone(defaults),
      warning: `Invalid config.yml, fallback to default. ${error.message}`,
    };
  }
}

module.exports = {
  loadConfig,
};
