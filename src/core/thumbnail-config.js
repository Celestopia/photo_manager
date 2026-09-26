const DEFAULT_THUMBNAIL_CONFIG = Object.freeze({
  size: 320, webpQuality: 80, extremeAspectRatio: 4, maxConcurrency: 4,
});

function finiteNumber(value, fallback, minimum, maximum = Infinity, integer = false) {
  const number = Number(value);
  if (value === null || value === "" || !Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, integer ? Math.trunc(number) : number));
}

function normalizeThumbnailConfig(raw = {}) {
  return {
    size: finiteNumber(raw?.size, 320, 64, Infinity, true),
    webpQuality: finiteNumber(raw?.webpQuality, 80, 1, 100, true),
    extremeAspectRatio: finiteNumber(raw?.extremeAspectRatio, 4, 2),
    maxConcurrency: finiteNumber(raw?.maxConcurrency, 4, 1, Infinity, true),
  };
}

module.exports = { DEFAULT_THUMBNAIL_CONFIG, normalizeThumbnailConfig, finiteNumber };
