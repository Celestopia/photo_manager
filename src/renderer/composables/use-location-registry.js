import { createRegistryRequests } from "../domain/registry-requests.mjs";
import { computed, nextTick, reactive, ref } from "vue";
import {
  toggleRegistryFilter,
  applyLocationSelectionFilter,
  isRegistryFilterValueValid,
} from "../domain/gallery-filter-state.mjs";
import {
  patchRegistryReferencesInPlace,
  registryDeletionInvalidatesFilter,
  removeRegistryReference,
} from "../domain/registry-deletion.mjs";
import {
  buildLocationCreateParentPatch,
  buildLocationHierarchyRows,
  getDefaultLocationExpansionKeys,
  getVisibleLocationHierarchyRows,
  compareLocationsByRegionAndTree,
  filterLocationsWithAncestors,
  buildLocationSubtreeCounts,
  buildLocationRegionCounts,
  locationRegionCountKey,
  getLocationPathLabel,
  getLocationRegionLabel,
  isLocationWithinSubtree,
  sameLocationRegionFilter,
  locationMatchesRegionFilter,
  locationMatchesKeyword,
  normalizeLocationField,
  normalizeLocationName,
} from "../domain/location-hierarchy.mjs";

/** Owns ID-backed hierarchical location pickers, manager folding, and registry mutations. */
export function useLocationRegistry({
  api, unassignedFilter, query, editDraft, batchEdit, selectedItem, orderedItems,
  gallerySettingsOpen, recentLocations, rememberRecentLocation,
  pruneRecentLocations, showToastMessage, closeOtherRegistryDropdowns, requestEdit,
  queryGallery, applyFilterSort,
}) {
  const locationRegistry = ref([]);
  const locationSearch = reactive({ viewer: "", batch: "" });
  const locationDropdown = reactive({ viewer: false, batch: false });
  const locationCreate = reactive({
    visible: false, target: "viewer", name: "", country: "", province: "", city: "",
    parentId: null, description: "", error: "",
  });
  const locationManager = reactive({
    visible: false, search: "", editingId: "", editName: "", editCountry: "", editProvince: "",
    editCity: "", editParentId: null, editDescription: "", saving: false, error: "",
  });
  const requests = createRegistryRequests(locationManager);
  const locationManagerListRef = ref(null);

  const managerExpandedKeys = ref(new Set());
  const managerSearchActive = computed(() => Boolean(locationManager.search.trim()));
  const managerFilteredLocations = computed(() => {
    const keyword = locationManager.search.trim();
    return filterLocationsWithAncestors(locationRegistry.value, keyword);
  });
  const managerHierarchyRows = computed(() => buildLocationHierarchyRows(managerFilteredLocations.value));
  const managerLocationRows = computed(() => getVisibleLocationHierarchyRows(
    managerHierarchyRows.value, managerExpandedKeys.value, managerSearchActive.value,
  ));
  const managerRegionCounts = computed(() => buildLocationRegionCounts(locationRegistry.value));
  function managerRegionTooltip(row) {
    const key = locationRegionCountKey(row.Region);
    if (!key) return "";
    const count = managerRegionCounts.value.get(key) || 0;
    return `${count} ${count === 1 ? "media item" : "media items"}`;
  }
  const managerSubtreeCounts = computed(() => buildLocationSubtreeCounts(locationRegistry.value));
  function managerLocationCount(row) {
    return managerRowExpanded(row)
      ? row.Location.UsageCount || 0
      : managerSubtreeCounts.value.get(row.Location.LocationId) || 0;
  }
  function managerRowExpanded(row) { return managerSearchActive.value || managerExpandedKeys.value.has(row.Key); }
  function managerFoldDisabled(row) {
    if (locationManager.saving || managerSearchActive.value) return true;
    const editing = managerHierarchyRows.value.find(item => item.Location?.LocationId === locationManager.editingId);
    return Boolean(editing && (!row || editing.RequiredExpansionKeys.includes(row.Key)));
  }
  function toggleManagerRow(row) {
    if (managerFoldDisabled(row)) return;
    const next = new Set(managerExpandedKeys.value);
    const keys = row.Type === "group" ? [row.Key, `group-locations:${row.Key}`] : [row.Key];
    if (next.has(row.Key)) keys.forEach(key => next.delete(key));
    else keys.forEach(key => next.add(key));
    managerExpandedKeys.value = next;
  }
  function expandManagerLocations() {
    if (locationManager.saving || managerSearchActive.value) return;
    managerExpandedKeys.value = new Set(managerHierarchyRows.value.flatMap(row => [row.Key, ...row.RequiredExpansionKeys]));
  }
  function collapseManagerLocations() {
    if (managerFoldDisabled()) return;
    managerExpandedKeys.value = new Set(getDefaultLocationExpansionKeys(managerHierarchyRows.value));
  }
  function revealManagerLocation(id) {
    if (!locationManager.visible) return;
    locationManager.search = "";
    const row = managerHierarchyRows.value.find(item => item.Location?.LocationId === id);
    if (!row) return;
    managerExpandedKeys.value = new Set([...managerExpandedKeys.value, ...row.RequiredExpansionKeys]);
    nextTick(() => locationManagerListRef.value?.querySelector(`[data-location-id="${id}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  function applyLocationRegistry(locations) {
    locationRegistry.value = (Array.isArray(locations) ? locations : []).map((location) => ({
      LocationId: normalizeLocationName(location?.LocationId),
      Name: normalizeLocationName(location?.Name),
      Country: normalizeLocationField(location?.Country),
      Province: normalizeLocationField(location?.Province),
      City: normalizeLocationField(location?.City),
      ParentId: location?.ParentId || null,
      Description: normalizeLocationField(location?.Description),
      CreatedAt: location?.CreatedAt || "",
      UpdatedAt: location?.UpdatedAt || "",
      UsageCount: Number(location?.UsageCount || 0),
      ChildrenIds: Array.isArray(location?.ChildrenIds) ? location.ChildrenIds : [],
      Depth: Number(location?.Depth || 0),
      Path: Array.isArray(location?.Path) ? location.Path : [],
    })).filter((location) => location.LocationId && location.Name).sort(compareLocationsByRegionAndTree);
    const ids = locationRegistry.value.map((location) => location.LocationId);
    pruneRecentLocations(ids);
    query.filters.location = query.filters.location.filter(value => isRegistryFilterValueValid(value, ids, unassignedFilter));
    query.filters.locationRegion = query.filters.locationRegion.filter(region => locationRegistry.value.some(location => locationMatchesRegionFilter(location, region)));
  }

  async function loadLocations() {
    const result = await requests.run(() => api.listLocations?.(), { read: true });
    if (result?.ok) applyLocationRegistry(result.locations);
    else if (result) showToastMessage(result.error || "Could not load locations");
  }

  function getLocation(locationId) { return locationRegistry.value.find((item) => item.LocationId === locationId) || null; }
  function getLocationName(locationId) { return getLocation(locationId)?.Name || ""; }
  function selectedLocationIdForTarget(target) { return target === "batch" ? batchEdit.locationId : editDraft.LocationId; }
  function getLocationTreeLabel(location) {
    const region = getLocationRegionLabel(location);
    return `${"　".repeat(Number(location?.Depth || 0))}${location?.Name || ""}${region ? ` - ${region}` : ""}`;
  }
  function getLocationTooltip(locationId) {
    const location = getLocation(locationId);
    return location ? [getLocationRegionLabel(location), getLocationPathLabel(location), location.Description].filter(Boolean).join("\n") : "";
  }

  function getLocationCandidates(target) {
    const keyword = normalizeLocationName(locationSearch[target]);
    return filterLocationsWithAncestors(locationRegistry.value, keyword).sort(compareLocationsByRegionAndTree);
  }
  function getRecentLocationOptions(target) {
    const keyword = normalizeLocationName(locationSearch[target]);
    const byId = new Map(locationRegistry.value
      .filter((location) => locationMatchesKeyword(location, keyword))
      .map((location) => [location.LocationId, location]));
    return recentLocations.value.map((id) => byId.get(id)).filter(Boolean).slice(0, 3);
  }
  function getLocationOptions(target) {
    return getLocationCandidates(target);
  }
  function createPinnedLocationRow(location, keyPrefix) {
    return {
      Type: "location",
      Key: `${keyPrefix}:${location.LocationId}`,
      Label: location.Name,
      Depth: 0,
      Location: location,
      Pinned: true,
    };
  }
  function composeLocationMenuRows(rows, recentOptions, keyPrefix = "") {
    const recentRows = recentOptions.map((location) => createPinnedLocationRow(
      location,
      `${keyPrefix}recent-location`,
    ));
    return [
      ...(recentRows.length ? [
        { Type: "section", Key: `${keyPrefix}section:recent`, Label: "Recent", Depth: 0 },
        ...recentRows,
      ] : []),
      ...(rows.length ? [
        { Type: "section", Key: `${keyPrefix}section:all`, Label: "All Locations", Depth: 0 },
        ...rows,
      ] : []),
    ];
  }
  function getLocationMenuRows(target) {
    const rows = buildLocationHierarchyRows(getLocationOptions(target));
    return composeLocationMenuRows(rows, getRecentLocationOptions(target));
  }
  function getLocationFilterRows(keywordValue = "") {
    const keyword = normalizeLocationName(keywordValue);
    const candidates = filterLocationsWithAncestors(locationRegistry.value, keyword).sort(compareLocationsByRegionAndTree);
    return buildLocationHierarchyRows(candidates);
  }
  async function setLocationFilter(locationId, additive = false) {
    if (!additive || !locationId) applyLocationSelectionFilter(query.filters, locationId);
    else query.filters.location = toggleRegistryFilter(query.filters.location, locationId, true);
    await applyFilterSort();
  }

  async function setLocationRegionFilter(region, additive = false) {
    const regions = query.filters.locationRegion;
    query.filters.locationRegion = additive
      ? regions.some(value => sameLocationRegionFilter(value, region))
        ? regions.filter(value => !sameLocationRegionFilter(value, region)) : [...regions, region]
      : [region];
    if (!additive) query.filters.location = [];
    await applyFilterSort();
  }

  function getLocationParentOptions(keywordValue = "", excludeId = "") {
    const keyword = normalizeLocationName(keywordValue);
    const excluded = new Set(excludeId ? [excludeId] : []);
    const children = new Map(locationRegistry.value.map((location) => [location.LocationId, []]));
    for (const location of locationRegistry.value) {
      if (location.ParentId && children.has(location.ParentId)) children.get(location.ParentId).push(location.LocationId);
    }
    const stack = [...(children.get(excludeId) || [])];
    while (stack.length) {
      const current = stack.pop();
      if (!current || excluded.has(current)) continue;
      excluded.add(current);
      stack.push(...(children.get(current) || []));
    }
    const eligible = locationRegistry.value
      .filter((location) => !excluded.has(location.LocationId))
      .sort(compareLocationsByRegionAndTree);
    return filterLocationsWithAncestors(eligible, keyword).sort(compareLocationsByRegionAndTree);
  }
  function getLocationParentRows(keywordValue = "", excludeId = "") {
    const keyword = normalizeLocationName(keywordValue);
    const options = getLocationParentOptions(keywordValue, excludeId);
    const optionById = new Map(options.map((location) => [location.LocationId, location]));
    const recentOptions = recentLocations.value
      .map((id) => optionById.get(id))
      .filter((location) => location && locationMatchesKeyword(location, keyword))
      .slice(0, 3);
    return composeLocationMenuRows(buildLocationHierarchyRows(options), recentOptions, "parent-");
  }

  function openLocationDropdown(target) {
    const shouldOpen = !locationDropdown[target];
    closeOtherRegistryDropdowns?.();
    locationDropdown[target] = shouldOpen;
  }
  function closeLocationDropdown(target) { locationDropdown[target] = false; }
  function closeAllLocationDropdowns() {
    locationDropdown.viewer = false;
    locationDropdown.batch = false;
  }
  function rememberSelectedLocation(locationId) {
    if (locationId && getLocation(locationId)) rememberRecentLocation(locationId);
  }
  function setLocationForTarget(target, locationId) {
    if (!getLocation(locationId)) return;
    if (target === "batch") batchEdit.locationId = locationId;
    else { editDraft.LocationId = locationId; requestEdit("Location"); }
    rememberSelectedLocation(locationId);
    locationSearch[target] = "";
    closeLocationDropdown(target);
  }
  function clearLocationForTarget(target) {
    if (target === "batch") batchEdit.locationId = null;
    else { editDraft.LocationId = null; requestEdit("Location"); }
    locationSearch[target] = "";
    closeLocationDropdown(target);
  }
  function resetLocationCreateState() {
    Object.assign(locationCreate, {
      visible: false, name: "", country: "", province: "", city: "", parentId: null,
      description: "", error: "",
    });
  }
  function openCreateLocationMenu(target) {
    if (locationManager.saving) return;
    closeOtherRegistryDropdowns?.();
    const currentId = target === "manager" ? null : selectedLocationIdForTarget(target);
    const current = getLocation(currentId);
    const parentPatch = buildLocationCreateParentPatch(current);
    Object.assign(locationCreate, {
      visible: true, target,
      name: target === "manager" ? "" : normalizeLocationName(locationSearch[target]),
      country: parentPatch.country || "", province: parentPatch.province || "", city: parentPatch.city || "",
      parentId: parentPatch.parentId, description: "", error: "",
    });
    if (target !== "manager") closeLocationDropdown(target);
  }
  function closeCreateLocationMenu() {
    if (locationManager.saving) return; resetLocationCreateState(); }
  function setCreateLocationParent(parentId) {
    if (locationManager.saving) return;
    const parent = getLocation(parentId);
    Object.assign(locationCreate, buildLocationCreateParentPatch(parent));
    rememberSelectedLocation(parent?.LocationId);
  }
  async function createLocationAndSelect() {
    if (locationManager.saving) return;
    const name = normalizeLocationName(locationCreate.name);
    if (!name) { locationCreate.error = "Location name is required"; return; }
    const target = locationCreate.target;
    const mediaId = selectedItem.value?.MediaId;
    const result = await requests.run(() => api.createLocation({
      name, country: locationCreate.country, province: locationCreate.province, city: locationCreate.city,
      parentId: locationCreate.parentId, description: locationCreate.description,
    }), { ownsTarget: () => locationCreate.visible && locationCreate.target === target && (target !== "viewer" || selectedItem.value?.MediaId === mediaId) });
    if (!result) return;
    if (!result?.ok) { locationCreate.error = result?.error || "Could not create location"; return; }
    applyLocationRegistry(result.locations);
    if (target === "manager") { revealManagerLocation(result.location.LocationId); showToastMessage(`Created location “${result.location.Name}”`); }
    else setLocationForTarget(target, result.location.LocationId);
    closeCreateLocationMenu();
  }

  async function openLocationManager() {
    gallerySettingsOpen.value = false;
    closeOtherRegistryDropdowns?.();
    if (locationManager.saving) return;
    locationManager.visible = true;
    locationManager.error = "";
    await loadLocations();
    managerExpandedKeys.value = new Set(getDefaultLocationExpansionKeys(managerHierarchyRows.value));

  }
  function cancelLocationEdit() {
    if (locationManager.saving) return;
    Object.assign(locationManager, {
      editingId: "", editName: "", editCountry: "", editProvince: "", editCity: "",
      editParentId: null, editDescription: "", saving: false, error: "",
    });
  }
  function closeLocationManager() {
    if (locationManager.saving) return;
    if (locationCreate.target === "manager") closeCreateLocationMenu();
    locationManager.visible = false; locationManager.search = ""; cancelLocationEdit();
  }
  function startLocationEdit(location) {
    if (locationManager.saving) return;
    Object.assign(locationManager, {
      editingId: location.LocationId, editName: location.Name || "",
      editCountry: location.Country || "", editProvince: location.Province || "",
      editCity: location.City || "", editParentId: location.ParentId || null,
      editDescription: location.Description || "", saving: false, error: "",
    });
  }
  function setEditLocationParent(parentId) {
    if (locationManager.saving) return;
    locationManager.editParentId = parentId || null;
    rememberSelectedLocation(parentId);
  }
  async function saveLocationEdit() {
    if (locationManager.saving) return;
    const locationId = locationManager.editingId;
    if (!locationId) { locationManager.error = "Location not found"; return; }
    const name = normalizeLocationName(locationManager.editName);
    if (!name) { locationManager.error = "Location name is required"; return; }
    const previous = getLocation(locationId);
    const country = normalizeLocationField(locationManager.editCountry);
    const province = normalizeLocationField(locationManager.editProvince);
    const city = normalizeLocationField(locationManager.editCity);
    const parentId = locationManager.editParentId || null;
    const result = await requests.run(() => api.updateLocation({
        locationId, name, country, province, city, parentId,
        description: locationManager.editDescription,
      }));
    if (!result) return;
    if (!result?.ok) { locationManager.error = result?.error || "Could not save location"; return; }
    const administrativeRegionChanged = Boolean(previous) && (
      previous.Country !== country || previous.Province !== province || previous.City !== city
    );
    const parentChanged = Boolean(previous) && previous.ParentId !== parentId;
    const shouldRefreshGallery = (
      (administrativeRegionChanged && Boolean(query.filters.locationRegion.length))
      || (parentChanged && Boolean(query.filters.location.length))
    );
    applyLocationRegistry(result.locations);
    cancelLocationEdit();
    if (administrativeRegionChanged || parentChanged) revealManagerLocation(locationId);

    const current = requests.capture();
    if (shouldRefreshGallery) await queryGallery();
    if (!current()) return;
    showToastMessage(previous?.Name === name ? "Location updated" : `Renamed location “${previous?.Name || ""}” to “${name}”`);
  }

  function syncDeletedLocationLocally(locationId, patchGallery) {
    if (selectedItem.value) selectedItem.value = removeRegistryReference(selectedItem.value, "location", locationId);
    if (editDraft.LocationId === locationId) { editDraft.LocationId = null; editDraft.LocationDetail = ""; }
    if (batchEdit.locationId === locationId) batchEdit.locationId = null;
    if (patchGallery) patchRegistryReferencesInPlace(orderedItems.value, "location", locationId);
  }
  async function deleteLocationGlobally(location) {
    if (locationManager.saving) return;
    const usage = Number(location?.UsageCount || 0);
    const childCount = Array.isArray(location?.ChildrenIds) ? location.ChildrenIds.length : 0;
    if (!window.confirm(`Delete location “${location.Name}” from the entire library? This will clear it from ${usage} media item(s) and detach ${childCount} direct child location(s).`)) return;
    const result = await requests.run(() => api.deleteLocationGlobally({ locationId: location.LocationId }));
    if (!result) return;
    if (!result?.ok) { showToastMessage(`Could not delete location: ${result?.error || "Unknown error"}`); return; }
    const filterBeforeDelete = query.filters.location;
    const updatedCount = Number(result.updatedCount || 0);
    const filteredSubtreeChanged = filterBeforeDelete.length
      && (updatedCount > 0 || Number(result.orphanedChildren) > 0)
      && filterBeforeDelete.some(id => id !== unassignedFilter && isLocationWithinSubtree(locationRegistry.value, location.LocationId, id));
    const shouldRefreshGallery = registryDeletionInvalidatesFilter(
      filterBeforeDelete, location.LocationId, unassignedFilter, updatedCount,
    ) || filteredSubtreeChanged || Boolean(query.filters.locationRegion.length);
    applyLocationRegistry(result.locations);
    syncDeletedLocationLocally(location.LocationId, updatedCount > 0 && !shouldRefreshGallery);
    const current = requests.capture();
    if (shouldRefreshGallery) await queryGallery();
    if (!current()) return;
    showToastMessage(`Deleted location “${location.Name}” from the library`);
  }

  function resetLocationState() {
    requests.reset();
    locationRegistry.value = [];
    Object.assign(locationSearch, { viewer: "", batch: "" });
    closeAllLocationDropdowns(); resetLocationCreateState();
    Object.assign(locationManager, {
      visible: false, search: "", editingId: "", editName: "", editCountry: "", editProvince: "",
      editCity: "", editParentId: null, editDescription: "", saving: false, error: "",
    });

    managerExpandedKeys.value = new Set();
  }

  return {
    locationRegistry, locationSearch, locationDropdown, locationCreate, locationManager,
    locationManagerListRef, managerFilteredLocations, managerLocationRows,
    managerRegionTooltip, managerLocationCount, managerSearchActive, managerRowExpanded, managerFoldDisabled, toggleManagerRow, expandManagerLocations, collapseManagerLocations,
    loadLocations, getLocationName, getLocationTreeLabel, getLocationTooltip,

    getLocationOptions, getRecentLocationOptions, getLocationMenuRows, getLocationFilterRows,
    setLocationFilter, setLocationRegionFilter, getLocationParentRows, openLocationDropdown,
    closeLocationDropdown, closeAllLocationDropdowns, setLocationForTarget, clearLocationForTarget,
    openCreateLocationMenu, closeCreateLocationMenu,
    setCreateLocationParent, createLocationAndSelect,
    openLocationManager, closeLocationManager, startLocationEdit, cancelLocationEdit,
    setEditLocationParent,
    saveLocationEdit, deleteLocationGlobally, resetLocationState,
  };
}
