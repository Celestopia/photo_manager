const {
  assertOptionalUuidV4,
  assertUuidArray,
  assertUuidV4,
} = require("./identity-schema.js");
const { assertCustomization } = require("./customization-schema.js");

function requireTrimmedText(value, context) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${context} must be a non-empty string`);
  if (value !== value.trim()) throw new Error(`${context} must not contain leading or trailing whitespace`);
  return value;
}

function assertTimestamp(value, context) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${context} must be an ISO timestamp`);
  }
  return value;
}

function validateSimpleRegistryEntries(entries, options) {
  const { idKey, labelKey, kind } = options;
  const byId = new Map();
  const byLabel = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const item = entries[index];
    const context = `${kind} registry record ${index + 1}`;
    const id = assertUuidV4(item?.[idKey], `${idKey} in ${context}`);
    const label = requireTrimmedText(item?.[labelKey], `${labelKey} in ${context}`);
    if (byId.has(id)) throw new Error(`${kind} registry contains duplicate ${idKey}: ${id}`);
    if (byLabel.has(label)) throw new Error(`${kind} registry contains duplicate ${labelKey}: ${label}`);
    if (typeof item.Description !== "string") throw new Error(`Description in ${context} must be a string`);
    assertTimestamp(item.CreatedAt, `CreatedAt in ${context}`);
    assertTimestamp(item.UpdatedAt, `UpdatedAt in ${context}`);
    byId.set(id, item);
    byLabel.set(label, id);
  }
  return { byId, byLabel };
}

function locationContextKey(location) {
  return [location.Name, location.Country, location.Province, location.City, location.ParentId || ""].join("\u0001");
}

function validateGlobalEntityIdUniqueness(registries = {}, mediaById = null) {
  const seen = new Map();
  const sources = [
    ["tag registry", registries.tags?.byId || registries.tags],
    ["album registry", registries.albums?.byId || registries.albums],
    ["person registry", registries.people?.byId || registries.people],
    ["location registry", registries.locations?.byId || registries.locations],
    ["media metadata", mediaById],
  ];
  for (const [source, index] of sources) {
    if (!(index instanceof Map)) continue;
    for (const id of index.keys()) {
      const previous = seen.get(id);
      if (previous) throw new Error(`Global entity ID collision between ${previous} and ${source}: ${id}`);
      seen.set(id, source);
    }
  }
  return seen;
}

function validateLocationRegistryEntries(entries) {
  const byId = new Map();
  const contextKeys = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const item = entries[index];
    const context = `location registry record ${index + 1}`;
    const id = assertUuidV4(item?.LocationId, `LocationId in ${context}`);
    if (byId.has(id)) throw new Error(`Location registry contains duplicate LocationId: ${id}`);
    requireTrimmedText(item?.Name, `Name in ${context}`);
    for (const field of ["Country", "Province", "City", "Description"]) {
      if (typeof item?.[field] !== "string") throw new Error(`${field} in ${context} must be a string`);
      if (item[field] !== item[field].trim()) throw new Error(`${field} in ${context} must not contain leading or trailing whitespace`);
    }
    if (!Object.prototype.hasOwnProperty.call(item, "ParentId")) throw new Error(`ParentId in ${context} is required`);
    const parentId = assertOptionalUuidV4(item.ParentId, `ParentId in ${context}`);
    if (item.ParentId !== parentId) throw new Error(`ParentId in ${context} must be null or a lowercase UUID v4`);
    assertTimestamp(item.CreatedAt, `CreatedAt in ${context}`);
    assertTimestamp(item.UpdatedAt, `UpdatedAt in ${context}`);
    const key = locationContextKey(item);
    if (contextKeys.has(key)) {
      throw new Error(`Location registry contains duplicate location context: ${item.Name}`);
    }
    contextKeys.set(key, id);
    byId.set(id, item);
  }

  for (const location of byId.values()) {
    if (!location.ParentId) continue;
    if (location.ParentId === location.LocationId) throw new Error(`Location cannot be its own parent: ${location.Name}`);
    if (!byId.has(location.ParentId)) throw new Error(`Unknown ParentId for location ${location.Name}: ${location.ParentId}`);
  }

  const complete = new Set();
  const visiting = new Set();
  function visit(id) {
    if (complete.has(id)) return;
    if (visiting.has(id)) throw new Error(`Location parent cycle detected at LocationId: ${id}`);
    visiting.add(id);
    const parentId = byId.get(id)?.ParentId;
    if (parentId) visit(parentId);
    visiting.delete(id);
    complete.add(id);
  }
  for (const id of byId.keys()) visit(id);
  return { byId, contextKeys };
}

function validateMediaEntries(entries, registries = {}) {
  const byId = new Map();
  const byPath = new Map();
  const knownTags = registries.tags?.byId || registries.tags || new Map();
  const knownAlbums = registries.albums?.byId || registries.albums || new Map();
  const knownPeople = registries.people?.byId || registries.people || new Map();
  const knownLocations = registries.locations?.byId || registries.locations || new Map();

  validateGlobalEntityIdUniqueness(registries);

  for (let index = 0; index < entries.length; index += 1) {
    const item = entries[index];
    const mediaId = assertUuidV4(item?.MediaId, `MediaId in metadata record ${index + 1}`);
    const filePath = requireTrimmedText(item?.FilePath, `FilePath for MediaId ${mediaId}`);
    if (byId.has(mediaId)) throw new Error(`Metadata contains duplicate MediaId: ${mediaId}`);
    if (byPath.has(filePath)) throw new Error(`Metadata contains duplicate FilePath: ${filePath}`);
    assertCustomization(item.Customization, filePath);

    const albumId = assertOptionalUuidV4(item.Customization.AlbumId, `AlbumId for ${filePath}`);
    if (albumId && !knownAlbums.has(albumId)) throw new Error(`Unknown AlbumId for ${filePath}: ${albumId}`);
    assertUuidArray(item.Customization.TagIds, `TagIds for ${filePath}`);
    for (const id of item.Customization.TagIds) {
      if (!knownTags.has(id)) throw new Error(`Unknown TagId for ${filePath}: ${id}`);
    }
    assertUuidArray(item.Customization.PersonIds, `PersonIds for ${filePath}`);
    for (const id of item.Customization.PersonIds) {
      if (!knownPeople.has(id)) throw new Error(`Unknown PersonId for ${filePath}: ${id}`);
    }

    if (!item.Location || typeof item.Location !== "object" || Array.isArray(item.Location)) {
      throw new Error(`Location must be an object for ${filePath}`);
    }
    if (!Object.prototype.hasOwnProperty.call(item.Location, "LocationId")) {
      throw new Error(`LocationId is required for ${filePath}`);
    }
    const locationId = assertOptionalUuidV4(item.Location.LocationId, `LocationId for ${filePath}`);
    if (item.Location.LocationId !== locationId) {
      throw new Error(`LocationId for ${filePath} must be null or a lowercase UUID v4`);
    }
    if (locationId && !knownLocations.has(locationId)) throw new Error(`Unknown LocationId for ${filePath}: ${locationId}`);
    if (typeof item.Location.Detail !== "string") throw new Error(`Location.Detail must be a string for ${filePath}`);

    byId.set(mediaId, item);
    byPath.set(filePath, mediaId);
  }
  validateGlobalEntityIdUniqueness(registries, byId);
  return { byId, byPath };
}

module.exports = {
  requireTrimmedText,
  validateSimpleRegistryEntries,
  validateLocationRegistryEntries,
  validateMediaEntries,
  validateGlobalEntityIdUniqueness,
  locationContextKey,
};
