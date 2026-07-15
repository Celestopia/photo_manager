const {
  assertOptionalUuidV4,
  assertUuidV4,
} = require("../shared/identity-schema.js");
const { validateSimpleRegistryEntries } = require("../shared/library-data-schema.js");

function createSimpleRegistryCatalog(options) {
  const {
    idKey,
    definitionKey,
    dataFileName,
    invalidKeyLabel = definitionKey,
    backupReason,
    normalize,
    normalizeLoadedDescription = normalize,
    extractReferences,
    getRegistry,
    getMetadata,
    resolveDataFile,
    prepareLibraryWrite,
    touchLibraryManifest,
    readJsonlStrict,
    writeJsonlAtomic,
  } = options;

  const sortDefinitions = (values) => [...values].sort((a, b) => a[definitionKey].localeCompare(b[definitionKey], "zh-CN"));

  function getUsageCounts() {
    const counts = new Map();
    for (const item of getMetadata().values()) {
      for (const id of extractReferences(item)) {
        if (!id) continue;
        counts.set(id, (counts.get(id) || 0) + 1);
      }
    }
    return counts;
  }

  function listDefinitions() {
    const usage = getUsageCounts();
    return sortDefinitions(getRegistry().values()).map((definition) => ({
      ...definition,
      UsageCount: usage.get(definition[idKey]) || 0,
    }));
  }

  async function save(options = {}) {
    if (options.backup !== false) await prepareLibraryWrite(backupReason);
    await writeJsonlAtomic(resolveDataFile(dataFileName), sortDefinitions(getRegistry().values()));
    await touchLibraryManifest();
  }

  async function load() {
    const registry = getRegistry();
    registry.clear();
    const entries = await readJsonlStrict(resolveDataFile(dataFileName), {
      label: dataFileName,
      keyOf: (item) => item?.[idKey],
    });
    validateSimpleRegistryEntries(entries, {
      idKey,
      labelKey: definitionKey,
      kind: invalidKeyLabel,
    });
    for (const parsed of entries) {
      const id = assertUuidV4(parsed[idKey], `${idKey} in ${dataFileName}`);
      registry.set(id, {
        [idKey]: id,
        [definitionKey]: normalize(parsed[definitionKey]),
        Description: normalizeLoadedDescription(parsed.Description),
        CreatedAt: parsed.CreatedAt,
        UpdatedAt: parsed.UpdatedAt,
      });
    }
  }

  function validateMany(rawValues) {
    const values = Array.isArray(rawValues) ? rawValues : [];
    const ids = [];
    const seen = new Set();
    for (const rawValue of values) {
      const id = String(rawValue || "").trim();
      if (!id) continue;
      assertUuidV4(id, idKey);
      if (!seen.has(id)) ids.push(id);
      seen.add(id);
    }
    return { values: ids, unknown: ids.filter((id) => !getRegistry().has(id)) };
  }

  function validateOne(rawValue) {
    const value = assertOptionalUuidV4(rawValue, idKey);
    return { value, unknown: value && !getRegistry().has(value) ? [value] : [] };
  }

  function findByLabel(rawLabel) {
    const label = normalize(rawLabel);
    return [...getRegistry().values()].find((definition) => definition[definitionKey] === label) || null;
  }

  return {
    findByLabel,
    getUsageCounts,
    listDefinitions,
    load,
    save,
    sortDefinitions,
    validateMany,
    validateOne,
  };
}

module.exports = { createSimpleRegistryCatalog };
