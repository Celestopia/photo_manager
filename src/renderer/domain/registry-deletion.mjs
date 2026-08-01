const SUPPORTED_REGISTRY_KINDS = new Set(["album", "tag", "person", "location"]);

function assertRegistryKind(kind) {
  if (!SUPPORTED_REGISTRY_KINDS.has(kind)) throw new Error(`Unsupported registry kind: ${kind}`);
}

export function removeRegistryReference(item, kind, deletedId) {
  assertRegistryKind(kind);
  if (!item || !deletedId) return item;

  if (kind === "location") {
    return item.Location?.LocationId === deletedId
      ? { ...item, Location: { LocationId: null, Detail: "" } }
      : item;
  }

  const customization = item.Customization || {};
  if (kind === "album") {
    return customization.AlbumId === deletedId
      ? { ...item, Customization: { ...customization, AlbumId: null } }
      : item;
  }

  const field = kind === "tag" ? "TagIds" : "PersonIds";
  const ids = Array.isArray(customization[field]) ? customization[field] : [];
  return ids.includes(deletedId)
    ? { ...item, Customization: { ...customization, [field]: ids.filter((id) => id !== deletedId) } }
    : item;
}

export function patchRegistryReferencesInPlace(items, kind, deletedId) {
  assertRegistryKind(kind);
  let updatedCount = 0;
  for (const item of items || []) {
    const updated = removeRegistryReference(item, kind, deletedId);
    if (updated === item) continue;
    if (kind === "location") item.Location = updated.Location;
    else item.Customization = updated.Customization;
    updatedCount += 1;
  }
  return updatedCount;
}

export function registryDeletionInvalidatesFilter(filterValue, deletedId, unassignedFilter, updatedCount) {
  if (filterValue === deletedId) return true;
  return filterValue === unassignedFilter && Number(updatedCount) > 0;
}
