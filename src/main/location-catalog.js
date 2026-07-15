const { validateLocationRegistryEntries, locationContextKey } = require("../shared/library-data-schema.js");

function createLocationCatalog(options) {
  const {
    dataFileName,
    getRegistry,
    getMetadata,
    normalizeField,
    normalizeObject,
    getChildrenMap,
    getDepth,
    buildPath,
    resolveDataFile,
    prepareLibraryWrite,
    touchLibraryManifest,
    readJsonlStrict,
    writeJsonlAtomic,
  } = options;

  function sortEntries(values) {
    return [...values].sort((a, b) => {
      const first = [a.Country, a.Province, a.City, a.Name, a.LocationId].join("\u0001");
      const second = [b.Country, b.Province, b.City, b.Name, b.LocationId].join("\u0001");
      return first.localeCompare(second, "zh-CN");
    });
  }

  function getUsageCounts() {
    const counts = new Map();
    for (const item of getMetadata().values()) {
      const locationId = item?.Location?.LocationId;
      if (locationId) counts.set(locationId, (counts.get(locationId) || 0) + 1);
    }
    return counts;
  }

  function listDefinitions() {
    const usage = getUsageCounts();
    const children = getChildrenMap();
    return [...getRegistry().values()]
      .map((location) => ({
        ...location,
        UsageCount: usage.get(location.LocationId) || 0,
        ChildrenIds: children.get(location.LocationId) || [],
        Depth: getDepth(location.LocationId),
        Path: buildPath(location.LocationId),
      }))
      .sort((a, b) => {
        const first = [a.Country, a.Province, a.City, ...a.Path, a.LocationId].join("\u0001");
        const second = [b.Country, b.Province, b.City, ...b.Path, b.LocationId].join("\u0001");
        return first.localeCompare(second, "zh-CN");
      });
  }

  async function save(options = {}) {
    if (options.backup !== false) await prepareLibraryWrite("location-registry-write");
    await writeJsonlAtomic(resolveDataFile(dataFileName), sortEntries(getRegistry().values()));
    await touchLibraryManifest();
  }

  async function load() {
    const registry = getRegistry();
    registry.clear();
    const entries = await readJsonlStrict(resolveDataFile(dataFileName), {
      label: dataFileName,
      keyOf: (item) => item?.LocationId,
    });
    validateLocationRegistryEntries(entries);
    for (const parsed of entries) {
      registry.set(parsed.LocationId, {
        LocationId: parsed.LocationId,
        Name: parsed.Name,
        Country: normalizeField(parsed.Country),
        Province: normalizeField(parsed.Province),
        City: normalizeField(parsed.City),
        ParentId: parsed.ParentId,
        Description: normalizeField(parsed.Description),
        CreatedAt: parsed.CreatedAt,
        UpdatedAt: parsed.UpdatedAt,
      });
    }
  }

  function normalizeRegistered(rawLocation) {
    const location = normalizeObject(rawLocation);
    const unknown = location.LocationId && !getRegistry().has(location.LocationId) ? [location.LocationId] : [];
    return { location, unknown };
  }

  function findDuplicate(candidate, excludeId = null) {
    const targetKey = locationContextKey(candidate);
    return [...getRegistry().values()].find((location) => (
      location.LocationId !== excludeId && locationContextKey(location) === targetKey
    )) || null;
  }

  return {
    findDuplicate,
    getUsageCounts,
    listDefinitions,
    load,
    normalizeRegistered,
    save,
    sortEntries,
  };
}

module.exports = { createLocationCatalog };
