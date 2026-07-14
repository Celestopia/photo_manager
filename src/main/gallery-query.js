const path = require("node:path");

function createGalleryQueryService({
  getLocationDescendants,
  normalizeAlbumTitle,
  normalizeLocationName,
  unassignedAlbumFilter,
}) {
  function filterAndSort(list, options) {
    const { filters, search, sortBy, sortOrder } = options;
    let output = list.filter((item) => !item?.Customization?.Hidden);

    if (filters.mediaType === "image" || filters.mediaType === "video") {
      output = output.filter((item) => item?.FileSystem?.FileType === filters.mediaType);
    }
    if (filters.album === unassignedAlbumFilter) {
      output = output.filter((item) => !normalizeAlbumTitle(item?.Customization?.Album));
    } else if (filters.album) {
      output = output.filter((item) => item?.Customization?.Album === filters.album);
    }
    if (filters.tag) {
      output = output.filter((item) => Array.isArray(item?.Customization?.Tags) && item.Customization.Tags.includes(filters.tag));
    }
    if (filters.person) {
      output = output.filter((item) => Array.isArray(item?.Customization?.People) && item.Customization.People.includes(filters.person));
    }
    if (filters.location) {
      const allowed = new Set([normalizeLocationName(filters.location), ...getLocationDescendants(filters.location)]);
      output = output.filter((item) => allowed.has(normalizeLocationName(item?.Location?.Place ?? item?.Location?.Site)));
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
