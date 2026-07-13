function createSimpleRegistryService(options) {
  const {
    kind,
    keyLabel,
    definitionKey,
    responseItemKey,
    responseListKey,
    dataFileName,
    descriptionRequired,
    normalize,
    readKey,
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
    mutateMetadataOnDelete,
    appendLog,
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
    const registry = getRegistry();
    if (registry.has(key)) return { ok: false, error: `${kind} already exists` };

    const now = new Date().toISOString();
    const definition = { [definitionKey]: key, Description: description, CreatedAt: now, UpdatedAt: now };
    registry.set(key, definition);
    try {
      await saveRegistry();
      return successPayload({ ...definition, UsageCount: 0 });
    } catch (error) {
      registry.delete(key);
      appendLog(`Failed to create ${kind.toLowerCase()}: ${error.message}`);
      return { ok: false, error: `Failed to write ${kind.toLowerCase()} registry` };
    }
  }

  async function updateDescription(payload) {
    requireOpenLibrary({ writable: true });
    const key = normalize(readKey(payload));
    const description = normalize(readDescription(payload));
    const registry = getRegistry();
    const current = registry.get(key);
    if (!key || (descriptionRequired && !description)) {
      return { ok: false, error: descriptionRequired ? `${keyLabel} and description are required` : `${keyLabel} is required` };
    }
    if (!current) return { ok: false, error: `${kind} not found` };

    const previous = { ...current };
    const next = { ...current, Description: description, UpdatedAt: new Date().toISOString() };
    registry.set(key, next);
    try {
      await saveRegistry();
      return successPayload({ ...next, UsageCount: getUsageCounts().get(key) || 0 });
    } catch (error) {
      registry.set(key, previous);
      appendLog(`Failed to update ${kind.toLowerCase()} description: ${error.message}`);
      return { ok: false, error: `Failed to write ${kind.toLowerCase()} registry` };
    }
  }

  async function deleteGlobal(payload) {
    requireOpenLibrary({ writable: true });
    const key = normalize(readKey(payload));
    const registry = getRegistry();
    if (!key || !registry.has(key)) return { ok: false, error: `${kind} not found` };
    try {
      await prepareLibraryWrite(`${kind.toLowerCase()}-global-delete`, { immediate: true });
    } catch (error) {
      return { ok: false, error: error.message };
    }

    const metadata = getMetadata();
    const previousRegistry = new Map(registry);
    const previousMetadata = new Map([...metadata.entries()].map(([filePath, item]) => [filePath, structuredClone(item)]));
    registry.delete(key);
    let updatedCount = 0;
    for (const [filePath, item] of metadata.entries()) {
      if (!mutateMetadataOnDelete(item, key)) continue;
      metadata.set(filePath, item);
      updatedCount += 1;
    }

    try {
      await saveTransaction(dataFileName, sortEntries(registry.values()), `${kind.toLowerCase()}-global-delete`, updatedCount > 0);
      return { ok: true, deleted: key, updatedCount, [responseListKey]: listDefinitions() };
    } catch (error) {
      setRegistry(previousRegistry);
      setMetadata(previousMetadata);
      appendLog(`Failed to delete ${kind.toLowerCase()} globally: ${error.message}`);
      return { ok: false, error: `Failed to delete ${kind.toLowerCase()}` };
    }
  }

  return { create, deleteGlobal, list, updateDescription };
}

module.exports = { createSimpleRegistryService };
