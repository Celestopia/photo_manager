const { assertPrivacy } = require("../shared/customization-schema.js");

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

  async function updateCustomization(payload) {
    requireOpenLibrary({ writable: true });
    const { filePath, customization, location } = payload;
    const metadata = getMetadata();
    const current = metadata.get(filePath);
    if (!current) return { ok: false, error: "Metadata item not found" };
    const previous = structuredClone(current);

    if (Object.prototype.hasOwnProperty.call(customization || {}, "Privacy")) {
      try {
        assertPrivacy(customization.Privacy);
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }

    if (Object.prototype.hasOwnProperty.call(customization || {}, "Tags")) {
      const validation = normalizeRegisteredTags(customization.Tags);
      if (validation.unknown.length) return { ok: false, error: `Unknown tag: ${validation.unknown.join(", ")}` };
      customization.Tags = validation.tags;
    }
    if (Object.prototype.hasOwnProperty.call(customization || {}, "Album")) {
      const validation = normalizeRegisteredAlbum(customization.Album);
      if (validation.unknown.length) return { ok: false, error: `Unknown album: ${validation.unknown.join(", ")}` };
      customization.Album = validation.album;
    }
    if (Object.prototype.hasOwnProperty.call(customization || {}, "People")) {
      const validation = normalizeRegisteredPeople(customization.People);
      if (validation.unknown.length) return { ok: false, error: `Unknown person: ${validation.unknown.join(", ")}` };
      customization.People = validation.people;
    }

    let normalizedLocation = null;
    if (location && typeof location === "object") {
      const validation = normalizeRegisteredLocation(location);
      if (validation.unknown.length) return { ok: false, error: `Unknown location: ${validation.unknown.join(", ")}` };
      normalizedLocation = validation.location;
    }

    current.Customization = {
      ...current.Customization,
      ...customization,
      MetadataUpdateDate: new Date().toISOString(),
    };
    delete current.Customization.Category;
    if (normalizedLocation) current.Location = normalizedLocation;
    metadata.set(filePath, current);

    try {
      await saveMetadata();
      return { ok: true, item: enrichItem(current) };
    } catch (error) {
      metadata.set(filePath, previous);
      appendLog(`Failed to write metadata: ${error.message}`);
      return { ok: false, error: "Failed to write metadata" };
    }
  }

  async function batchUpdate(payload) {
    requireOpenLibrary({ writable: true });
    const filePaths = Array.isArray(payload?.filePaths) ? payload.filePaths : [];
    const addTags = Array.isArray(payload?.addTags) ? payload.addTags : [];
    const addPeople = Array.isArray(payload?.addPeople) ? payload.addPeople : [];
    const locationPatch = payload?.locationPatch && typeof payload.locationPatch === "object" ? payload.locationPatch : {};
    const customizationPatch = payload?.customizationPatch && typeof payload.customizationPatch === "object" ? payload.customizationPatch : {};
    if (!filePaths.length) return { ok: false, error: "No target file paths" };

    if (Object.prototype.hasOwnProperty.call(customizationPatch, "Privacy")) {
      try {
        assertPrivacy(customizationPatch.Privacy);
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }

    const tagValidation = normalizeRegisteredTags([...new Set(addTags.map((value) => String(value || "").trim()).filter(Boolean))]);
    if (tagValidation.unknown.length) return { ok: false, error: `Unknown tag: ${tagValidation.unknown.join(", ")}` };
    const peopleValidation = normalizeRegisteredPeople([...new Set(addPeople.map((value) => String(value || "").trim()).filter(Boolean))]);
    if (peopleValidation.unknown.length) return { ok: false, error: `Unknown person: ${peopleValidation.unknown.join(", ")}` };

    if (Object.prototype.hasOwnProperty.call(customizationPatch, "Album")) {
      const albumValidation = normalizeRegisteredAlbum(customizationPatch.Album);
      if (albumValidation.unknown.length) return { ok: false, error: `Unknown album: ${albumValidation.unknown.join(", ")}` };
      customizationPatch.Album = albumValidation.album;
    }
    let normalizedLocationPatch = null;
    if (Object.prototype.hasOwnProperty.call(locationPatch, "Place")) {
      const locationValidation = normalizeRegisteredLocation({ Place: locationPatch.Place, Detail: "" });
      if (locationValidation.unknown.length) return { ok: false, error: `Unknown location: ${locationValidation.unknown.join(", ")}` };
      normalizedLocationPatch = locationValidation.location;
    }

    const metadata = getMetadata();
    const updatedItems = [];
    const previousItems = new Map();
    let missingCount = 0;
    for (const filePath of filePaths) {
      const current = metadata.get(filePath);
      if (!current) {
        missingCount += 1;
        continue;
      }
      previousItems.set(filePath, structuredClone(current));
      const mergedTags = [...(Array.isArray(current?.Customization?.Tags) ? current.Customization.Tags : [])];
      for (const tag of tagValidation.tags) if (!mergedTags.includes(tag)) mergedTags.push(tag);
      const mergedPeople = [...(Array.isArray(current?.Customization?.People) ? current.Customization.People : [])];
      for (const person of peopleValidation.people) if (!mergedPeople.includes(person)) mergedPeople.push(person);

      current.Customization = {
        ...current.Customization,
        ...customizationPatch,
        Tags: mergedTags,
        People: mergedPeople,
        MetadataUpdateDate: new Date().toISOString(),
      };
      delete current.Customization.Category;
      current.Location = normalizeLocationObject(current.Location);
      if (normalizedLocationPatch) current.Location.Place = normalizedLocationPatch.Place;
      metadata.set(filePath, current);
      updatedItems.push(enrichItem(current));
    }

    try {
      if (updatedItems.length) await saveMetadata();
      return {
        ok: true,
        requestedCount: filePaths.length,
        updatedCount: updatedItems.length,
        missingCount,
        items: updatedItems,
      };
    } catch (error) {
      for (const [filePath, previous] of previousItems) metadata.set(filePath, previous);
      appendLog(`Failed to batch-write metadata: ${error.message}`);
      return { ok: false, error: "Failed to write metadata" };
    }
  }

  return { batchUpdate, updateCustomization };
}

module.exports = { createMetadataEditService };
