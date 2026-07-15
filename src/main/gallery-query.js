const path = require("node:path");

function createGalleryQueryService({
  getLocationDescendants,
  getLocationIdsForRegion,
  unassignedAlbumFilter,
}) {
  function filterAndSort(list, options) {
    const { filters, search, sortBy, sortOrder } = options;
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
      let first;
      let second;
      if (sortBy === "filename") {
        first = path.basename(a.FilePath || "");
        second = path.basename(b.FilePath || "");
      } else if (sortBy === "rating") {
        first = a?.Customization?.Rating || 0;
        second = b?.Customization?.Rating || 0;
      } else {
        first = a?.FileSystem?.ShootingTimeString || "";
        second = b?.FileSystem?.ShootingTimeString || "";
      }
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
