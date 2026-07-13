const fs = require("node:fs");

function createSimpleRegistryCatalog(options) {
  const {
    definitionKey,
    dataFileName,
    defaultDescription,
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
      for (const rawValue of extractReferences(item)) {
        const value = normalize(rawValue);
        if (!value) continue;
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    }
    return counts;
  }

  function listDefinitions() {
    const usage = getUsageCounts();
    return sortDefinitions(getRegistry().values()).map((definition) => ({
      ...definition,
      UsageCount: usage.get(definition[definitionKey]) || 0,
    }));
  }

  async function save(options = {}) {
    if (options.backup !== false) await prepareLibraryWrite(backupReason);
    await writeJsonlAtomic(resolveDataFile(dataFileName), sortDefinitions(getRegistry().values()));
    await touchLibraryManifest();
  }

  function seedFromMetadata() {
    const registry = getRegistry();
    const now = new Date().toISOString();
    let added = 0;
    for (const item of getMetadata().values()) {
      for (const rawValue of extractReferences(item)) {
        const value = normalize(rawValue);
        if (!value || registry.has(value)) continue;
        registry.set(value, {
          [definitionKey]: value,
          Description: defaultDescription,
          CreatedAt: now,
          UpdatedAt: now,
        });
        added += 1;
      }
    }
    return added;
  }

  async function load() {
    const registry = getRegistry();
    registry.clear();
    const registryFile = resolveDataFile(dataFileName);
    const fileExists = fs.existsSync(registryFile);
    if (fileExists) {
      const entries = await readJsonlStrict(registryFile, {
        label: dataFileName,
        keyOf: (item) => item?.[definitionKey],
      });
      for (const parsed of entries) {
        const value = normalize(parsed?.[definitionKey]);
        if (!value || registry.has(value)) throw new Error(`Invalid or duplicate ${invalidKeyLabel}: ${value || "<empty>"}`);
        const createdAt = typeof parsed?.CreatedAt === "string" ? parsed.CreatedAt : new Date().toISOString();
        const updatedAt = typeof parsed?.UpdatedAt === "string" ? parsed.UpdatedAt : createdAt;
        registry.set(value, {
          [definitionKey]: value,
          Description: normalizeLoadedDescription(parsed?.Description),
          CreatedAt: createdAt,
          UpdatedAt: updatedAt,
        });
      }
    }
    const added = seedFromMetadata();
    if (!fileExists || added > 0) await save();
  }

  function validateMany(rawValues) {
    const values = Array.isArray(rawValues) ? rawValues : [];
    const normalized = [...new Set(values.map(normalize).filter(Boolean))];
    return { values: normalized, unknown: normalized.filter((value) => !getRegistry().has(value)) };
  }

  function validateOne(rawValue) {
    const value = normalize(rawValue);
    return { value, unknown: value && !getRegistry().has(value) ? [value] : [] };
  }

  return {
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
