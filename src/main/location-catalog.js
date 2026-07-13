const fs = require("node:fs");

function createLocationCatalog(options) {
  const {
    dataFileName,
    getRegistry,
    getMetadata,
    normalizeName,
    normalizeField,
    normalizeObject,
    getChildrenMap,
    getDepth,
    buildPath,
    validateParent,
    resolveDataFile,
    prepareLibraryWrite,
    touchLibraryManifest,
    readJsonlStrict,
    writeJsonlAtomic,
    saveTransaction,
    saveMetadata,
  } = options;

  function getUsageCounts() {
    const counts = new Map();
    for (const item of getMetadata().values()) {
      const place = normalizeName(item?.Location?.Place ?? item?.Location?.Site);
      if (place) counts.set(place, (counts.get(place) || 0) + 1);
    }
    return counts;
  }

  function listDefinitions() {
    const usage = getUsageCounts();
    const children = getChildrenMap();
    return [...getRegistry().values()]
      .map((location) => ({
        ...location,
        UsageCount: usage.get(location.Name) || 0,
        Children: children.get(location.Name) || [],
        Depth: getDepth(location.Name),
        Path: buildPath(location.Name),
      }))
      .sort((a, b) => a.Path.join("/").localeCompare(b.Path.join("/"), "zh-CN"));
  }

  async function save(options = {}) {
    if (options.backup !== false) await prepareLibraryWrite("location-registry-write");
    const entries = [...getRegistry().values()].sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN"));
    await writeJsonlAtomic(resolveDataFile(dataFileName), entries);
    await touchLibraryManifest();
  }

  function upsertFromMetadata(name, sourceLocation, now) {
    const registry = getRegistry();
    const locationName = normalizeName(name);
    if (!locationName || registry.has(locationName)) return false;
    registry.set(locationName, {
      Name: locationName,
      Country: normalizeField(sourceLocation?.Country),
      Province: normalizeField(sourceLocation?.Province),
      City: normalizeField(sourceLocation?.City),
      Parent: "",
      Description: "",
      CreatedAt: now,
      UpdatedAt: now,
    });
    return true;
  }

  function normalizeMetadataLocations() {
    const metadata = getMetadata();
    const now = new Date().toISOString();
    let registryAdded = 0;
    let metadataChanged = 0;
    for (const [filePath, item] of metadata.entries()) {
      const original = item?.Location && typeof item.Location === "object" ? item.Location : {};
      const place = normalizeName(original.Place ?? original.Site);
      const detail = normalizeField(original.Detail);
      if (place && upsertFromMetadata(place, original, now)) registryAdded += 1;
      const nextLocation = { Place: place, Detail: detail };
      if (original.Place !== nextLocation.Place || original.Detail !== nextLocation.Detail || Object.keys(original).some((key) => !["Place", "Detail"].includes(key))) {
        item.Location = nextLocation;
        item.Customization = { ...(item.Customization || {}), MetadataUpdateDate: item?.Customization?.MetadataUpdateDate || now };
        metadata.set(filePath, item);
        metadataChanged += 1;
      }
    }
    return { registryAdded, metadataChanged };
  }

  function sanitizeParentLinks() {
    const registry = getRegistry();
    let changed = 0;
    for (const [name, location] of registry.entries()) {
      const parent = normalizeName(location.Parent);
      if (!parent) {
        if (location.Parent !== "") {
          registry.set(name, { ...location, Parent: "", UpdatedAt: new Date().toISOString() });
          changed += 1;
        }
        continue;
      }
      if (!validateParent(name, parent).ok) {
        registry.set(name, { ...location, Parent: "", UpdatedAt: new Date().toISOString() });
        changed += 1;
      }
    }
    return changed;
  }

  async function load() {
    const registry = getRegistry();
    registry.clear();
    const registryFile = resolveDataFile(dataFileName);
    const fileExists = fs.existsSync(registryFile);
    if (fileExists) {
      const entries = await readJsonlStrict(registryFile, { label: dataFileName, keyOf: (item) => item?.Name });
      for (const parsed of entries) {
        const name = normalizeName(parsed.Name);
        if (!name || registry.has(name)) throw new Error(`Invalid or duplicate location key: ${name || "<empty>"}`);
        const createdAt = typeof parsed?.CreatedAt === "string" ? parsed.CreatedAt : new Date().toISOString();
        const updatedAt = typeof parsed?.UpdatedAt === "string" ? parsed.UpdatedAt : createdAt;
        registry.set(name, {
          Name: name,
          Country: normalizeField(parsed?.Country),
          Province: normalizeField(parsed?.Province),
          City: normalizeField(parsed?.City),
          Parent: normalizeName(parsed?.Parent),
          Description: normalizeField(parsed?.Description),
          CreatedAt: createdAt,
          UpdatedAt: updatedAt,
        });
      }
    }
    const normalized = normalizeMetadataLocations();
    const parentFixes = sanitizeParentLinks();
    const registryChanged = !fileExists || normalized.registryAdded > 0 || parentFixes > 0;
    if (registryChanged && normalized.metadataChanged > 0) {
      await prepareLibraryWrite("location-registry-migration");
      const entries = [...registry.values()].sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN"));
      await saveTransaction(dataFileName, entries, "location-registry-migration", true);
    } else if (registryChanged) {
      await save();
    } else if (normalized.metadataChanged > 0) {
      await saveMetadata();
    }
  }

  function normalizeRegistered(rawLocation) {
    const location = normalizeObject(rawLocation);
    const unknown = location.Place && !getRegistry().has(location.Place) ? [location.Place] : [];
    return { location, unknown };
  }

  return { getUsageCounts, listDefinitions, load, normalizeRegistered, save };
}

module.exports = { createLocationCatalog };
