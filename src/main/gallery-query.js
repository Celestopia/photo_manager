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
  unassignedAlbumFilter,
}) {
  function filterAndSort(list, options) {
    const { filters, search, sortBy, sortOrder } = options;
    if (sortBy !== "shootingTime") throw new Error(`Unsupported gallery sort: ${sortBy}`);
    let output = [...list];

    if (filters.mediaType === "image" || filters.mediaType === "video") {
      output = output.filter((item) => item?.FileSystem?.FileType === filters.mediaType);
    }
    if (filters.album === unassignedAlbumFilter) {
      output = output.filter((item) => !item?.Customization?.AlbumId);
    } else if (filters.album) {
      output = output.filter((item) => item?.Customization?.AlbumId === filters.album);
    }
    if (filters.tag) {
      output = output.filter((item) => Array.isArray(item?.Customization?.TagIds) && item.Customization.TagIds.includes(filters.tag));
    }
    if (filters.person) {
      output = output.filter((item) => Array.isArray(item?.Customization?.PersonIds) && item.Customization.PersonIds.includes(filters.person));
    }
    if (filters.location && filters.locationRegion) {
      throw new Error("Location and administrative region filters are mutually exclusive");
    }
    if (filters.locationRegion) {
      const allowed = new Set(getLocationIdsForRegion(filters.locationRegion));
      output = output.filter((item) => allowed.has(item?.Location?.LocationId));
    } else if (filters.location) {
      const allowed = new Set([filters.location, ...getLocationDescendants(filters.location)]);
      output = output.filter((item) => allowed.has(item?.Location?.LocationId));
    }
    const ratingLevels = selectedLevels(filters.ratingLevels, "Rating");
    if (ratingLevels.size) {
      output = output.filter((item) => ratingLevels.has(item?.Customization?.Rating));
    }
    const privacyLevels = selectedLevels(filters.privacyLevels, "Privacy");
    if (privacyLevels.size) {
      output = output.filter((item) => privacyLevels.has(item?.Customization?.Privacy));
    }
    if (search?.value && search?.field) {
      output = output.filter((item) => {
        let fieldValue = "";
        if (search.field === "title") fieldValue = item?.Customization?.Title || "";
        if (search.field === "filename") fieldValue = path.basename(item?.FilePath || "");
        if (search.field === "description") fieldValue = item?.Customization?.Description || "";
        return fieldValue.includes(search.value);
      });
    }

    output.sort((a, b) => {
      const first = a?.FileSystem?.ShootingTimeString || "";
      const second = b?.FileSystem?.ShootingTimeString || "";
      if (first < second) return sortOrder === "asc" ? -1 : 1;
      if (first > second) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
    return output;
  }

  function groupByDate(list) {
    const grouped = new Map();
    for (const item of list) {
      const date = item?.__groupDate || "未知日期";
      if (!grouped.has(date)) grouped.set(date, []);
      grouped.get(date).push(item);
    }
    return [...grouped.entries()].map(([date, items]) => ({ date, items }));
  }

  return { filterAndSort, groupByDate };
}

module.exports = { createGalleryQueryService };
