const { createEntityId, assertUuidV4 } = require("../shared/identity-schema.js");
const { assertExactObjectKeys } = require("../shared/object-schema.js");

function createSimpleRegistryService(options) {
  const {
    kind,
    keyLabel,
    idKey,
    definitionKey,
    responseItemKey,
    responseListKey,
    dataFileName,
    descriptionRequired,
    normalize,
    payloadKey,
    payloadIdKey,
    getRegistry,
    setRegistry,
    getMetadata,
    requireOpenLibrary,
    prepareLibraryWrite,
    saveRegistry,
    saveTransaction,
    listDefinitions,
    getUsageCounts,
    sortEntries,
    findByLabel,
    updateMetadataOnDelete,
    appendLog,
    createId = createEntityId,
  } = options;

  function successPayload(item) {
    return {
      ok: true,
      [responseItemKey]: item,
      [responseListKey]: listDefinitions(),
    };
  }

  async function list() {
    requireOpenLibrary();
    return { ok: true, [responseListKey]: listDefinitions() };
  }

  async function create(payload) {
    requireOpenLibrary({ writable: true });
    try {
      assertExactObjectKeys(payload, [payloadKey, "description"], `${kind} create payload`);
    } catch (error) {
      return { ok: false, error: error.message };
    }
    const key = normalize(payload[payloadKey]);
    const description = normalize(payload.description);
    if (!key || (descriptionRequired && !description)) {
      return { ok: false, error: descriptionRequired ? `${keyLabel} and description are required` : `${keyLabel} is required` };
    }
    if (findByLabel(key)) return { ok: false, error: `${kind} already exists` };

    const id = createId();
    const now = new Date().toISOString();
    const definition = { [idKey]: id, [definitionKey]: key, Description: description, CreatedAt: now, UpdatedAt: now };
    const registry = getRegistry();
    registry.set(id, definition);
    try {
      await saveRegistry();
      return successPayload({ ...definition, UsageCount: 0 });
    } catch (error) {
      registry.delete(id);
      appendLog(`Failed to create ${kind.toLowerCase()}: ${error.message}`);
      return { ok: false, error: `Failed to write ${kind.toLowerCase()} registry` };
    }
  }

  async function update(payload) {
    requireOpenLibrary({ writable: true });
    let id;
    try {
      assertExactObjectKeys(payload, [payloadIdKey, payloadKey, "description"], `${kind} update payload`);
      id = assertUuidV4(payload[payloadIdKey], idKey);
    } catch (error) {
      return { ok: false, error: error.message };
    }
    const key = normalize(payload[payloadKey]);
    const description = normalize(payload.description);
    const registry = getRegistry();
    const current = registry.get(id);
    if (!key || (descriptionRequired && !description)) {
      return { ok: false, error: descriptionRequired ? `${keyLabel} and description are required` : `${keyLabel} is required` };
    }
    if (!current) return { ok: false, error: `${kind} not found` };
    const duplicate = findByLabel(key);
    if (duplicate && duplicate[idKey] !== id) return { ok: false, error: `${kind} already exists` };

    const previous = { ...current };
    const next = {
      ...current,
      [definitionKey]: key,
      Description: description,
      UpdatedAt: new Date().toISOString(),
    };
    registry.set(id, next);
    try {
      await saveRegistry();
      return successPayload({ ...next, UsageCount: getUsageCounts().get(id) || 0 });
    } catch (error) {
      registry.set(id, previous);
      appendLog(`Failed to update ${kind.toLowerCase()}: ${error.message}`);
      return { ok: false, error: `Failed to write ${kind.toLowerCase()} registry` };
    }
  }

  async function deleteGlobal(payload) {
    requireOpenLibrary({ writable: true });
    let id;
    try {
      assertExactObjectKeys(payload, [payloadIdKey], `${kind} delete payload`);
      id = assertUuidV4(payload[payloadIdKey], idKey);
    } catch (error) {
      return { ok: false, error: error.message };
    }
    const registry = getRegistry();
    if (!registry.has(id)) return { ok: false, error: `${kind} not found` };
    try {
      await prepareLibraryWrite(`${kind.toLowerCase()}-global-delete`, { immediate: true });
    } catch (error) {
      return { ok: false, error: error.message };
    }

    const metadata = getMetadata();
    const previousRegistry = new Map(registry);
    const previousMetadata = new Map();
    registry.delete(id);
    let updatedCount = 0;
    const now = new Date().toISOString();
    for (const [mediaId, item] of metadata.entries()) {
      const updated = updateMetadataOnDelete(item, id, now);
      if (!updated) continue;
      previousMetadata.set(mediaId, item);
      metadata.set(mediaId, updated);
      updatedCount += 1;
    }

    try {
      await saveTransaction(dataFileName, sortEntries(registry.values()), `${kind.toLowerCase()}-global-delete`, updatedCount > 0);
      return { ok: true, deletedId: id, updatedCount, [responseListKey]: listDefinitions() };
    } catch (error) {
      setRegistry(previousRegistry);
      for (const [mediaId, item] of previousMetadata.entries()) metadata.set(mediaId, item);
      appendLog(`Failed to delete ${kind.toLowerCase()} globally: ${error.message}`);
      return { ok: false, error: `Failed to delete ${kind.toLowerCase()}` };
    }
  }

  return { create, deleteGlobal, list, update };
}

module.exports = { createSimpleRegistryService };
