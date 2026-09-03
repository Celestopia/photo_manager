const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { DEFAULT_MEDIA_CONFIG, normalizeMediaConfig } = require("./media-tools.js");

const DEFAULT_CONFIG = Object.freeze({
  thumbnail: {
    size: 320,
    webpQuality: 80,
    extremeAspectRatio: 4,
    maxConcurrency: 4,
  },
  media: { ...DEFAULT_MEDIA_CONFIG },
  backup: { retentionCount: 10 },
  ui: {
    gallery: {
      minCardWidth: 190,
    },
    viewer: {
      panelRatio: {
        left: 1,
        center: 3,
        right: 1,
      },
      panels: {
        showLeft: true,
        showRight: true,
      },
      zoom: {
        minPercent: 10,
        maxPercent: 1000,
        stepPercent: 10,
      },
    },
  },
});

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

function normalizeConfig(parsed) {
  return {
    thumbnail: mergeKnownShape(DEFAULT_CONFIG.thumbnail, parsed?.thumbnail),
    media: normalizeMediaConfig(parsed?.media),
    backup: {
      retentionCount: Math.max(1, Math.trunc(Number(parsed?.backup?.retentionCount) || DEFAULT_CONFIG.backup.retentionCount)),
    },
    ui: mergeKnownShape(DEFAULT_CONFIG.ui, parsed?.ui),
  };
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, yaml.dump(DEFAULT_CONFIG), "utf8");
    return { config: structuredClone(DEFAULT_CONFIG), warning: "" };
  }

  try {
    const parsed = yaml.load(fs.readFileSync(configPath, "utf8"));
    return { config: normalizeConfig(parsed), warning: "" };
  } catch (error) {
    return {
      config: structuredClone(DEFAULT_CONFIG),
      warning: `Invalid config.yml, fallback to default. ${error.message}`,
    };
  }
}

module.exports = {
  DEFAULT_CONFIG,
  loadConfig,
  normalizeConfig,
};
