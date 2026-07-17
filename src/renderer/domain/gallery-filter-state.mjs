const LEVELS = Object.freeze([1, 2, 3, 4, 5]);

export function normalizeGalleryLevels(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((level) => Number.isInteger(level) && LEVELS.includes(level)))].sort((a, b) => a - b);
}

export function toggleGalleryLevel(current, level) {
  const normalizedLevel = Number(level);
  if (!Number.isInteger(normalizedLevel) || !LEVELS.includes(normalizedLevel)) return normalizeGalleryLevels(current);
  const next = new Set(normalizeGalleryLevels(current));
  if (next.has(normalizedLevel)) next.delete(normalizedLevel);
  else next.add(normalizedLevel);
  return [...next].sort((a, b) => a - b);
}

export function createDefaultGalleryFilters() {
  return {
    mediaType: "",
    album: "",
    tag: "",
    person: "",
    location: "",
    locationRegion: null,
    ratingLevels: [],
    privacyLevels: [1],
  };
}

export function hasNonDefaultGalleryControls(query) {
  const filters = query?.filters || {};
  const privacyLevels = normalizeGalleryLevels(filters.privacyLevels);
  return Boolean(
    filters.mediaType
    || filters.album
    || filters.tag
    || filters.person
    || filters.location
    || filters.locationRegion
    || normalizeGalleryLevels(filters.ratingLevels).length
    || privacyLevels.length !== 1
    || privacyLevels[0] !== 1
    || query?.sortBy !== "shootingTime"
    || query?.sortOrder !== "desc"
  );
}

export const GALLERY_LEVELS = LEVELS;
