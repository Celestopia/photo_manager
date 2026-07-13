const fs = require("node:fs");
const fsp = require("node:fs/promises");
const yaml = require("js-yaml");

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, patch) {
  const output = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function normalizeConfig(parsed, defaults, normalizeMediaConfig) {
  return {
    thumbnail: {
      ...defaults.thumbnail,
      ...(parsed?.thumbnail || {}),
    },
    media: normalizeMediaConfig(parsed?.media),
    backup: {
      retentionCount: Math.max(1, Math.trunc(Number(parsed?.backup?.retentionCount) || defaults.backup.retentionCount)),
    },
    ui: {
      ...defaults.ui,
      ...(parsed?.ui || {}),
      gallery: {
        ...defaults.ui.gallery,
        ...(parsed?.ui?.gallery || {}),
      },
      viewer: {
        ...defaults.ui.viewer,
        ...(parsed?.ui?.viewer || {}),
        panelRatio: {
          ...defaults.ui.viewer.panelRatio,
          ...(parsed?.ui?.viewer?.panelRatio || {}),
        },
        panels: {
          ...defaults.ui.viewer.panels,
          ...(parsed?.ui?.viewer?.panels || {}),
        },
        zoom: {
          ...defaults.ui.viewer.zoom,
          ...(parsed?.ui?.viewer?.zoom || {}),
        },
      },
    },
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

function applyConfigPatch(current, patch, normalizeMediaConfig) {
  const allowedPatch = {};
  for (const key of ["thumbnail", "media", "backup", "ui"]) {
    if (patch?.[key] !== undefined) allowedPatch[key] = patch[key];
  }
  const next = deepMerge(current, allowedPatch);
  next.media = normalizeMediaConfig(next.media);
  next.backup.retentionCount = Math.max(1, Math.trunc(Number(next.backup.retentionCount) || 10));
  return next;
}

async function saveConfig(configPath, config) {
  await fsp.writeFile(configPath, yaml.dump(config), "utf8");
}

module.exports = {
  applyConfigPatch,
  loadConfig,
  saveConfig,
};
