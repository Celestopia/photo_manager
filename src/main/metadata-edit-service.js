const {
  EDITABLE_CUSTOMIZATION_FIELDS,
  assertCustomizationPatch,
} = require("../shared/customization-schema.js");
const { assertUuidArray, assertUuidV4 } = require("../shared/identity-schema.js");
const { assertExactObjectKeys } = require("../shared/object-schema.js");

const BATCH_CUSTOMIZATION_FIELDS = Object.freeze(["Title", "Rating", "Privacy", "AlbumId"]);

function createMetadataEditService(options) {
  const {
    getMetadata,
    requireOpenLibrary,
    normalizeRegisteredTags,
    normalizeRegisteredAlbum,
    normalizeRegisteredPeople,
    normalizeRegisteredLocation,
    normalizeLocationObject,
    saveMetadata,
    enrichItem,
    appendLog,
  } = options;

  function validateCustomizationReferences(customization) {
    assertCustomizationPatch(customization, EDITABLE_CUSTOMIZATION_FIELDS);
    if (Object.prototype.hasOwnProperty.call(customization, "TagIds")) {
      const validation = normalizeRegisteredTags(customization.TagIds);
      if (validation.unknown.length) throw new Error(`Unknown TagId: ${validation.unknown.join(", ")}`);
      customization.TagIds = validation.tagIds;
    }
    if (Object.prototype.hasOwnProperty.call(customization, "AlbumId")) {
      const validation = normalizeRegisteredAlbum(customization.AlbumId);
      if (validation.unknown.length) throw new Error(`Unknown AlbumId: ${validation.unknown.join(", ")}`);
      customization.AlbumId = validation.albumId;
    }
    if (Object.prototype.hasOwnProperty.call(customization, "PersonIds")) {
      const validation = normalizeRegisteredPeople(customization.PersonIds);
      if (validation.unknown.length) throw new Error(`Unknown PersonId: ${validation.unknown.join(", ")}`);
      customization.PersonIds = validation.personIds;
    }
  }

  async function updateCustomization(payload) {
    requireOpenLibrary({ writable: true });
    try {
      assertExactObjectKeys(payload, ["mediaId", "customization", "location"], "Metadata update payload");
    } catch (error) {
      return { ok: false, error: error.message };
    }
    let mediaId;
    try {
      mediaId = assertUuidV4(payload.mediaId, "mediaId");
    } catch (error) {
      return { ok: false, error: error.message };
    }
    if (payload.customization !== undefined && (!payload.customization || typeof payload.customization !== "object" || Array.isArray(payload.customization))) {
      return { ok: false, error: "customization must be an object" };
    }
    if (payload.location !== undefined && payload.location !== null
      && (typeof payload.location !== "object" || Array.isArray(payload.location))) {
      return { ok: false, error: "location must be an object or null" };
    }
    const customization = { ...(payload.customization || {}) };
    const location = payload?.location;
    const metadata = getMetadata();
    const current = metadata.get(mediaId);
    if (!current) return { ok: false, error: "Metadata item not found" };
    const previous = structuredClone(current);

    try {
      validateCustomizationReferences(customization);
    } catch (error) {
      return { ok: false, error: error.message };
    }

    let normalizedLocation = null;
    if (location && typeof location === "object") {
      try {
        assertExactObjectKeys(location, ["LocationId", "Detail"], "Location patch");
        if (typeof location.Detail !== "string") throw new Error("Location patch.Detail must be a string");
        const validation = normalizeRegisteredLocation(location);
        if (validation.unknown.length) return { ok: false, error: `Unknown LocationId: ${validation.unknown.join(", ")}` };
        normalizedLocation = validation.location;
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }

    current.Customization = {
      ...current.Customization,
      ...customization,
      MetadataUpdateDate: new Date().toISOString(),
    };
    if (normalizedLocation) current.Location = normalizedLocation;
    metadata.set(mediaId, current);

    try {
      await saveMetadata();
      return { ok: true, item: enrichItem(current) };
    } catch (error) {
      metadata.set(mediaId, previous);
      appendLog(`Failed to write metadata: ${error.message}`);
      return { ok: false, error: "Failed to write metadata" };
    }
  }

  async function batchUpdate(payload) {
    requireOpenLibrary({ writable: true });
    try {
      assertExactObjectKeys(
        payload,
        ["mediaIds", "addTagIds", "addPersonIds", "locationPatch", "customizationPatch"],
        "Batch metadata update payload",
      );
    } catch (error) {
      return { ok: false, error: error.message };
    }
    if (!Array.isArray(payload.mediaIds) || !Array.isArray(payload.addTagIds) || !Array.isArray(payload.addPersonIds)) {
      return { ok: false, error: "mediaIds, addTagIds, and addPersonIds must be arrays" };
    }
    if (!payload.locationPatch || typeof payload.locationPatch !== "object" || Array.isArray(payload.locationPatch)
      || !payload.customizationPatch || typeof payload.customizationPatch !== "object" || Array.isArray(payload.customizationPatch)) {
      return { ok: false, error: "locationPatch and customizationPatch must be objects" };
    }
    const mediaIds = [...payload.mediaIds];
    const addTagIds = [...payload.addTagIds];
    const addPersonIds = [...payload.addPersonIds];
    const locationPatch = { ...payload.locationPatch };
    const customizationPatch = { ...payload.customizationPatch };
    if (!mediaIds.length) return { ok: false, error: "No target MediaIds" };

    let tagValidation;
    let peopleValidation;
    try {
      assertUuidArray(mediaIds, "mediaIds");
      assertUuidArray(addTagIds, "addTagIds");
      assertUuidArray(addPersonIds, "addPersonIds");
      assertCustomizationPatch(customizationPatch, BATCH_CUSTOMIZATION_FIELDS, "Batch customization patch");
      validateCustomizationReferences(customizationPatch);
      tagValidation = normalizeRegisteredTags(addTagIds);
      peopleValidation = normalizeRegisteredPeople(addPersonIds);
    } catch (error) {
      return { ok: false, error: error.message };
    }
    if (tagValidation.unknown.length) return { ok: false, error: `Unknown TagId: ${tagValidation.unknown.join(", ")}` };
    if (peopleValidation.unknown.length) return { ok: false, error: `Unknown PersonId: ${peopleValidation.unknown.join(", ")}` };

    let normalizedLocationPatch = null;
    try {
      assertExactObjectKeys(locationPatch, ["LocationId"], "Batch location patch");
    } catch (error) {
      return { ok: false, error: error.message };
    }
    if (Object.prototype.hasOwnProperty.call(locationPatch, "LocationId")) {
      try {
        const validation = normalizeRegisteredLocation({ LocationId: locationPatch.LocationId, Detail: "" });
        if (validation.unknown.length) return { ok: false, error: `Unknown LocationId: ${validation.unknown.join(", ")}` };
        normalizedLocationPatch = validation.location;
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }

    const metadata = getMetadata();
    const updatedItems = [];
    const previousItems = new Map();
    let missingCount = 0;
    for (const mediaId of mediaIds) {
      const current = metadata.get(mediaId);
      if (!current) {
        missingCount += 1;
        continue;
      }
      previousItems.set(mediaId, structuredClone(current));
      const mergedTagIds = [...(Array.isArray(current?.Customization?.TagIds) ? current.Customization.TagIds : [])];
      for (const tagId of tagValidation.tagIds) if (!mergedTagIds.includes(tagId)) mergedTagIds.push(tagId);
      const mergedPersonIds = [...(Array.isArray(current?.Customization?.PersonIds) ? current.Customization.PersonIds : [])];
      for (const personId of peopleValidation.personIds) if (!mergedPersonIds.includes(personId)) mergedPersonIds.push(personId);

      current.Customization = {
        ...current.Customization,
        ...customizationPatch,
        TagIds: mergedTagIds,
        PersonIds: mergedPersonIds,
        MetadataUpdateDate: new Date().toISOString(),
      };
      current.Location = normalizeLocationObject(current.Location);
      if (normalizedLocationPatch) current.Location.LocationId = normalizedLocationPatch.LocationId;
      metadata.set(mediaId, current);
      updatedItems.push(enrichItem(current));
    }

    try {
      if (updatedItems.length) await saveMetadata();
      return {
        ok: true,
        requestedCount: mediaIds.length,
        updatedCount: updatedItems.length,
        missingCount,
        items: updatedItems,
      };
    } catch (error) {
      for (const [mediaId, previous] of previousItems) metadata.set(mediaId, previous);
      appendLog(`Failed to batch-write metadata: ${error.message}`);
      return { ok: false, error: "Failed to write metadata" };
    }
  }

  return { batchUpdate, updateCustomization };
}

module.exports = { createMetadataEditService };
