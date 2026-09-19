const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { DEFAULT_MEDIA_CONFIG, normalizeMediaConfig } = require("./media-tools.js");
const { DEFAULT_THUMBNAIL_CONFIG, normalizeThumbnailConfig, finiteNumber } = require("./thumbnail-config.js");

const DEFAULT_CONFIG = Object.freeze({
  thumbnail: { ...DEFAULT_THUMBNAIL_CONFIG },
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
  if (typeof defaultValue === "boolean") return typeof candidate === "boolean" ? candidate : defaultValue;
  if (typeof defaultValue === "number") return Number(candidate) > 0 ? finiteNumber(candidate, defaultValue, Number.MIN_VALUE) : defaultValue;
  if (!isPlainObject(defaultValue)) return candidate === undefined ? defaultValue : candidate;
  const source = isPlainObject(candidate) ? candidate : {};
  return Object.fromEntries(
    Object.entries(defaultValue).map(([key, value]) => [key, mergeKnownShape(value, source[key])]),
  );
}

function normalizeConfig(parsed) {
  const ui = mergeKnownShape(DEFAULT_CONFIG.ui, parsed?.ui);
  ui.viewer.zoom.maxPercent = Math.max(ui.viewer.zoom.minPercent, ui.viewer.zoom.maxPercent);
  return {
    thumbnail: normalizeThumbnailConfig(parsed?.thumbnail),
    media: normalizeMediaConfig(parsed?.media),
    backup: {
      retentionCount: finiteNumber(parsed?.backup?.retentionCount, DEFAULT_CONFIG.backup.retentionCount, 1, Infinity, true),
    },
    ui,
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
