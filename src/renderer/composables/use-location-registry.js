import { computed, nextTick, reactive, ref, watch } from "vue";
import {
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
  compareLocationsByRegionAndTree,
  filterLocationsWithAncestors,
  getLocationManagerRowContext,
  getLocationPathLabel,
  getLocationRegionLabel,
  isLocationWithinSubtree,
  locationMatchesRegionFilter,
  locationMatchesKeyword,
  normalizeLocationField,
  normalizeLocationName,
} from "../domain/location-hierarchy.mjs";

/** Owns ID-backed hierarchical location pickers, context bars, and registry mutations. */
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
  const locationManagerListRef = ref(null);
  const locationManagerContext = ref("");

  const managerFilteredLocations = computed(() => {
    const keyword = locationManager.search.trim();
    return keyword ? locationRegistry.value.filter((location) => locationMatchesKeyword(location, keyword)) : [...locationRegistry.value];
  });
  const managerLocationRows = computed(() => buildLocationHierarchyRows(managerFilteredLocations.value));

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
    if (!isRegistryFilterValueValid(query.filters.location, ids, unassignedFilter)) query.filters.location = "";
    if (query.filters.locationRegion && !locationRegistry.value.some((location) => locationMatchesRegionFilter(location, query.filters.locationRegion))) {
      query.filters.locationRegion = null;
    }
  }

  async function loadLocations() {
    const result = await api.listLocations?.();
    if (result?.ok) applyLocationRegistry(result.locations);
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

  function updateLocationManagerContext() {
    const list = locationManagerListRef.value;
    if (!list) { locationManagerContext.value = ""; return; }
    const listTop = list.getBoundingClientRect().top;
    const items = [...list.querySelectorAll(".location-manager-item[data-location-context]")];
    let current = null;
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      if (rect.top <= listTop + 1 && rect.bottom > listTop) current = item;
      else if (!current && rect.top > listTop) { current = item; break; }
    }
    locationManagerContext.value = current?.dataset?.locationContext || "";
  }
  function scheduleLocationManagerContextUpdate() { if (locationManager.visible) nextTick(updateLocationManagerContext); }

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
  async function setLocationFilter(locationId) {
    applyLocationSelectionFilter(query.filters, locationId);
    await applyFilterSort();
  }

  async function setLocationRegionFilter(region) {
    query.filters.location = "";
    query.filters.locationRegion = region ? {
      level: normalizeLocationField(region.level),
      country: normalizeLocationField(region.country),
      province: normalizeLocationField(region.province),
      city: normalizeLocationField(region.city),
    } : null;
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
  function closeCreateLocationMenu() { resetLocationCreateState(); }
  function setCreateLocationParent(parentId) {
    const parent = getLocation(parentId);
    Object.assign(locationCreate, buildLocationCreateParentPatch(parent));
    rememberSelectedLocation(parent?.LocationId);
  }
  async function createLocationAndSelect() {
    const name = normalizeLocationName(locationCreate.name);
    if (!name) { locationCreate.error = "Location name is required"; return; }
    const result = await api.createLocation({
      name, country: locationCreate.country, province: locationCreate.province, city: locationCreate.city,
      parentId: locationCreate.parentId, description: locationCreate.description,
    });
    if (!result?.ok) { locationCreate.error = result?.error || "Could not create location"; return; }
    applyLocationRegistry(result.locations);
    const target = locationCreate.target;
    if (target === "manager") { showToastMessage(`Created location “${result.location.Name}”`); scheduleLocationManagerContextUpdate(); }
    else setLocationForTarget(target, result.location.LocationId);
    closeCreateLocationMenu();
  }

  async function openLocationManager() {
    gallerySettingsOpen.value = false;
    closeOtherRegistryDropdowns?.();
    await loadLocations();
    locationManager.visible = true;
    locationManager.error = "";
    scheduleLocationManagerContextUpdate();
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
    locationManager.visible = false; locationManager.search = ""; locationManagerContext.value = ""; cancelLocationEdit();
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
    locationManager.editParentId = parentId || null;
    rememberSelectedLocation(parentId);
  }
  async function saveLocationEdit() {
    const locationId = locationManager.editingId;
    if (!locationId) { locationManager.error = "Location not found"; return; }
    const name = normalizeLocationName(locationManager.editName);
    if (!name) { locationManager.error = "Location name is required"; return; }
    const previous = getLocation(locationId);
    const country = normalizeLocationField(locationManager.editCountry);
    const province = normalizeLocationField(locationManager.editProvince);
    const city = normalizeLocationField(locationManager.editCity);
    const parentId = locationManager.editParentId || null;
    locationManager.saving = true;
    let result;
    try {
      result = await api.updateLocation({
        locationId, name, country, province, city, parentId,
        description: locationManager.editDescription,
      });
    } catch {
      locationManager.saving = false;
      locationManager.error = "Could not save location";
      return;
    }
    locationManager.saving = false;
    if (!result?.ok) { locationManager.error = result?.error || "Could not save location"; return; }
    const administrativeRegionChanged = Boolean(previous) && (
      previous.Country !== country || previous.Province !== province || previous.City !== city
    );
    const parentChanged = Boolean(previous) && previous.ParentId !== parentId;
    const shouldRefreshGallery = (
      (administrativeRegionChanged && Boolean(query.filters.locationRegion))
      || (parentChanged && Boolean(query.filters.location))
    );
    applyLocationRegistry(result.locations);
    cancelLocationEdit();
    scheduleLocationManagerContextUpdate();
    if (shouldRefreshGallery) await queryGallery();
    showToastMessage(previous?.Name === name ? "Location updated" : `Renamed location “${previous?.Name || ""}” to “${name}”`);
  }

  function syncDeletedLocationLocally(locationId, patchGallery) {
    if (selectedItem.value) selectedItem.value = removeRegistryReference(selectedItem.value, "location", locationId);
    if (editDraft.LocationId === locationId) { editDraft.LocationId = null; editDraft.LocationDetail = ""; }
    if (batchEdit.locationId === locationId) batchEdit.locationId = null;
    if (patchGallery) patchRegistryReferencesInPlace(orderedItems.value, "location", locationId);
  }
  async function deleteLocationGlobally(location) {
    const usage = Number(location?.UsageCount || 0);
    const childCount = Array.isArray(location?.ChildrenIds) ? location.ChildrenIds.length : 0;
    if (!window.confirm(`Delete location “${location.Name}” from the entire library? This will clear it from ${usage} media item(s) and detach ${childCount} direct child location(s).`)) return;
    const result = await api.deleteLocationGlobally({ locationId: location.LocationId });
    if (!result?.ok) { showToastMessage(`Could not delete location: ${result?.error || "Unknown error"}`); return; }
    const filterBeforeDelete = query.filters.location;
    const updatedCount = Number(result.updatedCount || 0);
    const filteredSubtreeChanged = filterBeforeDelete
      && filterBeforeDelete !== unassignedFilter
      && updatedCount > 0
      && isLocationWithinSubtree(locationRegistry.value, location.LocationId, filterBeforeDelete);
    const shouldRefreshGallery = registryDeletionInvalidatesFilter(
      filterBeforeDelete, location.LocationId, unassignedFilter, updatedCount,
    ) || filteredSubtreeChanged || Boolean(query.filters.locationRegion);
    applyLocationRegistry(result.locations);
    syncDeletedLocationLocally(location.LocationId, updatedCount > 0 && !shouldRefreshGallery);
    if (shouldRefreshGallery) await queryGallery();
    showToastMessage(`Deleted location “${location.Name}” from the library`);
  }

  function resetLocationState() {
    locationRegistry.value = [];
    Object.assign(locationSearch, { viewer: "", batch: "" });
    closeAllLocationDropdowns(); resetLocationCreateState();
    Object.assign(locationManager, {
      visible: false, search: "", editingId: "", editName: "", editCountry: "", editProvince: "",
      editCity: "", editParentId: null, editDescription: "", saving: false, error: "",
    });
    locationManagerContext.value = "";
  }
  watch(() => [locationManager.visible, locationManager.search, managerLocationRows.value.length], scheduleLocationManagerContextUpdate);

  return {
    locationRegistry, locationSearch, locationDropdown, locationCreate, locationManager,
    locationManagerListRef, locationManagerContext, managerFilteredLocations, managerLocationRows,
    loadLocations, getLocationName, getLocationTreeLabel, getLocationTooltip,
    getLocationManagerRowContext, updateLocationManagerContext, scheduleLocationManagerContextUpdate,
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
