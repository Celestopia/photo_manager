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
    const selections = {};
    for (const key of ['album', 'tag', 'person', 'location']) {
      if (!Array.isArray(filters[key]) || filters[key].some(id => typeof id !== 'string' || !id)) throw new Error(`${key} filters must be arrays of nonempty IDs`);
      selections[key] = new Set(filters[key]);
    }
    if (!Array.isArray(filters.locationRegion)) throw new Error('Location regions must be an array');
    const allowedLocationIds = new Set();
    for (const id of selections.location) {
      if (id === unassignedFilter) continue;
      allowedLocationIds.add(id);
      for (const child of getLocationDescendants(id)) allowedLocationIds.add(child);
    }
    for (const region of filters.locationRegion) {
      for (const id of getLocationIdsForRegion(region)) allowedLocationIds.add(id);
    }
    const matches = (selected, values) => !selected.size || values.some(id => selected.has(id))
      || (!values.length && selected.has(unassignedFilter));
    const ratingLevels = selectedLevels(filters.ratingLevels, "Rating");
    const privacyLevels = selectedLevels(filters.privacyLevels, "Privacy");
    const requestedMediaType = filters.mediaType === "image" || filters.mediaType === "video"
      ? filters.mediaType
      : "";
    const searchActive = Boolean(search?.value && search?.field);
    const output = [];

    for (const item of list) {
      const customization = item?.Customization;
      const locationId = item?.Location?.LocationId;
      if (!matches(selections.album, customization?.AlbumId ? [customization.AlbumId] : [])) continue;
      if (!matches(selections.tag, customization?.TagIds || [])) continue;
      if (!matches(selections.person, customization?.PersonIds || [])) continue;
      if ((selections.location.size || filters.locationRegion.length)
        && !allowedLocationIds.has(locationId)
        && !(locationId === null && selections.location.has(unassignedFilter))) continue;

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
      if (!requestedMediaType || fileType === requestedMediaType) output.push(item);
    }

    output.sort((a, b) => {
      const first = a?.FileSystem?.ShootingTimeString || "";
      const second = b?.FileSystem?.ShootingTimeString || "";
      if (first < second) return sortOrder === "asc" ? -1 : 1;
      if (first > second) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
    return { items: output };
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
