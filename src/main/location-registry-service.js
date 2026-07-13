function createLocationRegistryService(options) {
  const {
    dataFileName,
    getRegistry,
    setRegistry,
    getMetadata,
    setMetadata,
    normalizeName,
    normalizeField,
    validateParent,
    getDepth,
    buildPath,
    listDefinitions,
    requireOpenLibrary,
    prepareLibraryWrite,
    saveRegistry,
    saveTransaction,
    appendLog,
  } = options;

  async function list() {
    requireOpenLibrary();
    return { ok: true, locations: listDefinitions() };
  }

  async function create(payload) {
    requireOpenLibrary({ writable: true });
    const name = normalizeName(payload?.name ?? payload?.Name);
    if (!name) return { ok: false, error: "Location name is required" };
    const registry = getRegistry();
    if (registry.has(name)) return { ok: false, error: "Location already exists" };
    const parentValidation = validateParent(name, payload?.parent ?? payload?.Parent);
    if (!parentValidation.ok) return { ok: false, error: parentValidation.error };

    const now = new Date().toISOString();
    const location = {
      Name: name,
      Country: normalizeField(payload?.country ?? payload?.Country),
      Province: normalizeField(payload?.province ?? payload?.Province),
      City: normalizeField(payload?.city ?? payload?.City),
      Parent: parentValidation.parent,
      Description: normalizeField(payload?.description ?? payload?.Description),
      CreatedAt: now,
      UpdatedAt: now,
    };
    registry.set(name, location);
    try {
      await saveRegistry();
      return {
        ok: true,
        location: { ...location, UsageCount: 0, Children: [], Depth: getDepth(name), Path: buildPath(name) },
        locations: listDefinitions(),
      };
    } catch (error) {
      registry.delete(name);
      appendLog(`Failed to create location: ${error.message}`);
      return { ok: false, error: "Failed to write location registry" };
    }
  }

  async function update(payload) {
    requireOpenLibrary({ writable: true });
    const name = normalizeName(payload?.name ?? payload?.Name);
    const registry = getRegistry();
    const current = registry.get(name);
    if (!name || !current) return { ok: false, error: "Location not found" };
    const parentValidation = validateParent(name, payload?.parent ?? payload?.Parent);
    if (!parentValidation.ok) return { ok: false, error: parentValidation.error };

    const previous = { ...current };
    const next = {
      ...current,
      Country: normalizeField(payload?.country ?? payload?.Country),
      Province: normalizeField(payload?.province ?? payload?.Province),
      City: normalizeField(payload?.city ?? payload?.City),
      Parent: parentValidation.parent,
      Description: normalizeField(payload?.description ?? payload?.Description),
      UpdatedAt: new Date().toISOString(),
    };
    registry.set(name, next);
    try {
      await saveRegistry();
      const locations = listDefinitions();
      return { ok: true, location: locations.find((location) => location.Name === name), locations };
    } catch (error) {
      registry.set(name, previous);
      appendLog(`Failed to update location: ${error.message}`);
      return { ok: false, error: "Failed to write location registry" };
    }
  }

  async function deleteGlobal(payload) {
    requireOpenLibrary({ writable: true });
    const name = normalizeName(payload?.name ?? payload?.Name);
    const registry = getRegistry();
    if (!name || !registry.has(name)) return { ok: false, error: "Location not found" };
    try {
      await prepareLibraryWrite("location-global-delete", { immediate: true });
    } catch (error) {
      return { ok: false, error: error.message };
    }

    const metadata = getMetadata();
    const previousRegistry = new Map(registry);
    const previousMetadata = new Map([...metadata.entries()].map(([filePath, item]) => [filePath, structuredClone(item)]));
    let updatedCount = 0;
    let orphanedChildren = 0;
    const now = new Date().toISOString();
    registry.delete(name);
    for (const [childName, location] of registry.entries()) {
      if (normalizeName(location.Parent) !== name) continue;
      registry.set(childName, { ...location, Parent: "", UpdatedAt: now });
      orphanedChildren += 1;
    }
    for (const [filePath, item] of metadata.entries()) {
      if (normalizeName(item?.Location?.Place ?? item?.Location?.Site) !== name) continue;
      item.Location = { Place: "", Detail: "" };
      item.Customization = { ...(item.Customization || {}), MetadataUpdateDate: now };
      metadata.set(filePath, item);
      updatedCount += 1;
    }

    try {
      const entries = [...registry.values()].sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN"));
      await saveTransaction(dataFileName, entries, "location-global-delete", updatedCount > 0);
      return { ok: true, deleted: name, updatedCount, orphanedChildren, locations: listDefinitions() };
    } catch (error) {
      setRegistry(previousRegistry);
      setMetadata(previousMetadata);
      appendLog(`Failed to delete location globally: ${error.message}`);
      return { ok: false, error: "Failed to delete location" };
    }
  }

  return { create, deleteGlobal, list, update };
}

module.exports = { createLocationRegistryService };
