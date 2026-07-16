const { assertUuidV4, createEntityId } = require("../shared/identity-schema.js");

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
    findDuplicate,
    sortEntries,
    requireOpenLibrary,
    prepareLibraryWrite,
    saveRegistry,
    saveTransaction,
    appendLog,
    createId = createEntityId,
  } = options;

  async function list() {
    requireOpenLibrary();
    return { ok: true, locations: listDefinitions() };
  }

  async function create(payload) {
    requireOpenLibrary({ writable: true });
    const name = normalizeName(payload?.name ?? payload?.Name);
    if (!name) return { ok: false, error: "Location name is required" };
    const locationId = createId();
    let parentValidation;
    try {
      parentValidation = validateParent(locationId, payload?.parentId ?? payload?.ParentId);
    } catch (error) {
      return { ok: false, error: error.message };
    }
    if (!parentValidation.ok) return { ok: false, error: parentValidation.error };

    const now = new Date().toISOString();
    const location = {
      LocationId: locationId,
      Name: name,
      Country: normalizeField(payload?.country ?? payload?.Country),
      Province: normalizeField(payload?.province ?? payload?.Province),
      City: normalizeField(payload?.city ?? payload?.City),
      ParentId: parentValidation.parentId,
      Description: normalizeField(payload?.description ?? payload?.Description),
      CreatedAt: now,
      UpdatedAt: now,
    };
    if (findDuplicate(location)) return { ok: false, error: "Location already exists in the same administrative and parent context" };

    const registry = getRegistry();
    registry.set(locationId, location);
    try {
      await saveRegistry();
      return {
        ok: true,
        location: { ...location, UsageCount: 0, ChildrenIds: [], Depth: getDepth(locationId), Path: buildPath(locationId) },
        locations: listDefinitions(),
      };
    } catch (error) {
      registry.delete(locationId);
      appendLog(`Failed to create location: ${error.message}`);
      return { ok: false, error: "Failed to write location registry" };
    }
  }

  async function update(payload) {
    requireOpenLibrary({ writable: true });
    let locationId;
    try {
      locationId = assertUuidV4(payload?.locationId ?? payload?.LocationId, "LocationId");
    } catch (error) {
      return { ok: false, error: error.message };
    }
    const registry = getRegistry();
    const current = registry.get(locationId);
    if (!current) return { ok: false, error: "Location not found" };
    const name = normalizeName(payload?.name ?? payload?.Name);
    if (!name) return { ok: false, error: "Location name is required" };
    let parentValidation;
    try {
      parentValidation = validateParent(locationId, payload?.parentId ?? payload?.ParentId);
    } catch (error) {
      return { ok: false, error: error.message };
    }
    if (!parentValidation.ok) return { ok: false, error: parentValidation.error };

    const previous = { ...current };
    const next = {
      ...current,
      Name: name,
      Country: normalizeField(payload?.country ?? payload?.Country),
      Province: normalizeField(payload?.province ?? payload?.Province),
      City: normalizeField(payload?.city ?? payload?.City),
      ParentId: parentValidation.parentId,
      Description: normalizeField(payload?.description ?? payload?.Description),
      UpdatedAt: new Date().toISOString(),
    };
    if (findDuplicate(next, locationId)) return { ok: false, error: "Location already exists in the same administrative and parent context" };
    registry.set(locationId, next);
    try {
      await saveRegistry();
      const locations = listDefinitions();
      return { ok: true, location: locations.find((location) => location.LocationId === locationId), locations };
    } catch (error) {
      registry.set(locationId, previous);
      appendLog(`Failed to update location: ${error.message}`);
      return { ok: false, error: "Failed to write location registry" };
    }
  }

  async function deleteGlobal(payload) {
    requireOpenLibrary({ writable: true });
    let locationId;
    try {
      locationId = assertUuidV4(payload?.locationId ?? payload?.LocationId, "LocationId");
    } catch (error) {
      return { ok: false, error: error.message };
    }
    const registry = getRegistry();
    if (!registry.has(locationId)) return { ok: false, error: "Location not found" };
    try {
      await prepareLibraryWrite("location-global-delete", { immediate: true });
    } catch (error) {
      return { ok: false, error: error.message };
    }

    const metadata = getMetadata();
    const previousRegistry = new Map(registry);
    const previousMetadata = new Map([...metadata.entries()].map(([mediaId, item]) => [mediaId, structuredClone(item)]));
    let updatedCount = 0;
    let orphanedChildren = 0;
    const now = new Date().toISOString();
    registry.delete(locationId);
    for (const [childId, location] of registry.entries()) {
      if (location.ParentId !== locationId) continue;
      registry.set(childId, { ...location, ParentId: null, UpdatedAt: now });
      orphanedChildren += 1;
    }
    for (const [mediaId, item] of metadata.entries()) {
      if (item?.Location?.LocationId !== locationId) continue;
      item.Location = { LocationId: null, Detail: "" };
      item.Customization = { ...(item.Customization || {}), MetadataUpdateDate: now };
      metadata.set(mediaId, item);
      updatedCount += 1;
    }

    try {
      await saveTransaction(dataFileName, sortEntries(registry.values()), "location-global-delete", updatedCount > 0);
      return { ok: true, deletedId: locationId, updatedCount, orphanedChildren, locations: listDefinitions() };
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
