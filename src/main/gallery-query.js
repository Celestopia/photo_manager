const path = require("node:path");

function selectedLevels(value, label) {
  if (value == null) return new Set();
  if (!Array.isArray(value)) throw new Error(`${label} filters must be an array`);
  const levels = new Set();
  for (const rawLevel of value) {
    const level = Number(rawLevel);
    if (!Number.isInteger(level) || level < 1 || level > 5) throw new Error(`${label} filters must contain integers from 1 through 5`);
    levels.add(level);
  }
  return levels;
}

function createGalleryQueryService({
  getLocationDescendants,
  getLocationIdsForRegion,
  unassignedFilter,
}) {
  function execute(list, options) {
    const { filters, search, sortBy, sortOrder } = options;
    if (sortBy !== "shootingTime") throw new Error(`Unsupported gallery sort: ${sortBy}`);
    if (filters.location && filters.locationRegion) {
      throw new Error("Location and administrative region filters are mutually exclusive");
    }
    let allowedLocationIds = null;
    if (filters.locationRegion) {
      allowedLocationIds = new Set(getLocationIdsForRegion(filters.locationRegion));
    } else if (filters.location) {
      allowedLocationIds = filters.location === unassignedFilter
        ? null
        : new Set([filters.location, ...getLocationDescendants(filters.location)]);
    }
    const ratingLevels = selectedLevels(filters.ratingLevels, "Rating");
    const privacyLevels = selectedLevels(filters.privacyLevels, "Privacy");
    const requestedMediaType = filters.mediaType === "image" || filters.mediaType === "video"
      ? filters.mediaType
      : "";
    const searchActive = Boolean(search?.value && search?.field);
    const output = [];
    const mediaCounts = { all: 0, images: 0, videos: 0 };

    for (const item of list) {
      const customization = item?.Customization;
      const locationId = item?.Location?.LocationId;
      if (filters.album === unassignedFilter) {
        if (customization?.AlbumId !== null) continue;
      } else if (filters.album && customization?.AlbumId !== filters.album) continue;

      if (filters.tag === unassignedFilter) {
        if (!Array.isArray(customization?.TagIds) || customization.TagIds.length !== 0) continue;
      } else if (filters.tag && (!Array.isArray(customization?.TagIds) || !customization.TagIds.includes(filters.tag))) continue;

      if (filters.person === unassignedFilter) {
        if (!Array.isArray(customization?.PersonIds) || customization.PersonIds.length !== 0) continue;
      } else if (filters.person && (!Array.isArray(customization?.PersonIds) || !customization.PersonIds.includes(filters.person))) continue;

      if (filters.locationRegion && !allowedLocationIds.has(locationId)) continue;
      if (filters.location === unassignedFilter) {
        if (locationId !== null) continue;
      } else if (filters.location && !allowedLocationIds.has(locationId)) continue;

      if (ratingLevels.size && !ratingLevels.has(customization?.Rating)) continue;
      if (privacyLevels.size && !privacyLevels.has(customization?.Privacy)) continue;

      if (searchActive) {
        let fieldValue = "";
        if (search.field === "title") fieldValue = customization?.Title || "";
        if (search.field === "filename") fieldValue = path.basename(item?.FilePath || "");
        if (search.field === "description") fieldValue = customization?.Description || "";
        if (!fieldValue.includes(search.value)) continue;
      }

      const fileType = item?.FileSystem?.FileType;
      mediaCounts.all += 1;
      if (fileType === "image") mediaCounts.images += 1;
      if (fileType === "video") mediaCounts.videos += 1;
      if (!requestedMediaType || fileType === requestedMediaType) output.push(item);
    }

    output.sort((a, b) => {
      const first = a?.FileSystem?.ShootingTimeString || "";
      const second = b?.FileSystem?.ShootingTimeString || "";
      if (first < second) return sortOrder === "asc" ? -1 : 1;
      if (first > second) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
    return { items: output, mediaCounts };
  }

  function groupByDate(list) {
    const grouped = new Map();
    for (const item of list) {
      const date = item?.__groupDate || "Unknown date";
      if (!grouped.has(date)) grouped.set(date, []);
      grouped.get(date).push(item);
    }
    return [...grouped.entries()].map(([date, items]) => ({ date, items }));
  }

  return { execute, groupByDate };
}

module.exports = { createGalleryQueryService };
