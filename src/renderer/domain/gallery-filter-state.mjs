import { RATING_LEVELS as LEVELS } from "../../shared/customization-levels.js";

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
    album: [],
    tag: [],
    person: [],
    location: [],
    locationRegion: [],
    ratingLevels: [],
    privacyLevels: [1],
  };
}

export function isRegistryFilterValueValid(value, registeredIds, unassignedFilter) {
  if (!value || value === unassignedFilter) return true;
  return Array.isArray(registeredIds) && registeredIds.includes(value);
}

export function applyLocationSelectionFilter(filters, locationValue) {
  filters.location = locationValue ? [locationValue] : [];
  filters.locationRegion = [];
}

export function hasNonDefaultGalleryControls(query) {
  const filters = query?.filters || {};
  const privacyLevels = normalizeGalleryLevels(filters.privacyLevels);
  return Boolean(
    filters.mediaType
    || filters.album?.length
    || filters.tag?.length
    || filters.person?.length
    || filters.location?.length
    || filters.locationRegion?.length
    || normalizeGalleryLevels(filters.ratingLevels).length
    || privacyLevels.length !== 1
    || privacyLevels[0] !== 1
    || String(query?.search?.value || "").trim()
    || query?.sortBy !== "shootingTime"
    || query?.sortOrder !== "desc"
  );
}

export function toggleRegistryFilter(current, value, additive = false) {
  if (!value) return [];
  if (!additive) return [value];
  return current.includes(value) ? current.filter(id => id !== value) : [...current, value];
}

/** Shared UI registry matching; never changes stored text or general media search. */
export function matchesRegistrySearch(search, ...values) {
  const keyword = String(search ?? "").trim().toLocaleLowerCase("en-US");
  return !keyword || values.some(value => String(value ?? "").toLocaleLowerCase("en-US").includes(keyword));
}
