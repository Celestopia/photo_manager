const fs = require("node:fs");
const yaml = require("js-yaml");

function normalizeConfig(parsed, defaults, normalizeMediaConfig) {
  const normalized = {
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
  delete normalized.ui.gallery?.pageSize;
  delete normalized.ui.language;
  return normalized;
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
