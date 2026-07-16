const { createEntityId, assertUuidV4 } = require("../shared/identity-schema.js");

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
    readKey,
    readId,
    readDescription,
    getRegistry,
    setRegistry,
    getMetadata,
    setMetadata,
    requireOpenLibrary,
    prepareLibraryWrite,
    saveRegistry,
    saveTransaction,
    listDefinitions,
    getUsageCounts,
    sortEntries,
    findByLabel,
    mutateMetadataOnDelete,
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
    const key = normalize(readKey(payload));
    const description = normalize(readDescription(payload));
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
      id = assertUuidV4(readId(payload), idKey);
    } catch (error) {
      return { ok: false, error: error.message };
    }
    const key = normalize(readKey(payload));
    const description = normalize(readDescription(payload));
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
      id = assertUuidV4(readId(payload), idKey);
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
    const previousMetadata = new Map([...metadata.entries()].map(([mediaId, item]) => [mediaId, structuredClone(item)]));
    registry.delete(id);
    let updatedCount = 0;
    for (const [mediaId, item] of metadata.entries()) {
      if (!mutateMetadataOnDelete(item, id)) continue;
      metadata.set(mediaId, item);
      updatedCount += 1;
    }

    try {
      await saveTransaction(dataFileName, sortEntries(registry.values()), `${kind.toLowerCase()}-global-delete`, updatedCount > 0);
      return { ok: true, deletedId: id, updatedCount, [responseListKey]: listDefinitions() };
    } catch (error) {
      setRegistry(previousRegistry);
      setMetadata(previousMetadata);
      appendLog(`Failed to delete ${kind.toLowerCase()} globally: ${error.message}`);
      return { ok: false, error: `Failed to delete ${kind.toLowerCase()}` };
    }
  }

  return { create, deleteGlobal, list, update };
}

module.exports = { createSimpleRegistryService };
