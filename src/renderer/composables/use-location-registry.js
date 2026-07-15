import { computed, nextTick, reactive, ref, triggerRef, watch } from "vue";
import {
  buildLocationHierarchyRows,
  compareLocationsByRegionAndTree,
  getLocationManagerRowContext,
  getLocationPathLabel,
  getLocationRegionLabel,
  locationMatchesKeyword,
  normalizeLocationField,
  normalizeLocationName,
} from "../domain/location-hierarchy.mjs";

/** Owns ID-backed hierarchical location pickers, context bars, and registry mutations. */
export function useLocationRegistry({
  api, filterOptions, query, editDraft, batchEdit, selectedItem, orderedItems,
  galleryGroups, gallerySettingsOpen, recentLocations, rememberRecentLocation,
  pruneRecentLocations, showToastMessage, closeOtherRegistryDropdowns, requestEdit,
  rebuildGalleryItemIndex, galleryItemIndex, queryGallery, applyFilterSort,
}) {
  const locationRegistry = ref([]);
  const locationSearch = reactive({ viewer: "", batch: "" });
  const locationDropdown = reactive({ viewer: false, batch: false });
  const locationCreate = reactive({
    visible: false, target: "viewer", name: "", country: "", province: "", city: "",
    parentId: null, parentSearch: "", parentDropdown: false, description: "", error: "",
  });
  const locationManager = reactive({
    visible: false, search: "", editingId: "", editCountry: "", editProvince: "",
    editCity: "", editParentId: null, editDescription: "", error: "",
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
    filterOptions.locations = locationRegistry.value;
    const ids = locationRegistry.value.map((location) => location.LocationId);
    pruneRecentLocations(ids);
    if (query.filters.location && !ids.includes(query.filters.location)) query.filters.location = "";
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
    return locationRegistry.value.filter((location) => locationMatchesKeyword(location, keyword)).sort(compareLocationsByRegionAndTree);
  }
  function getRecentLocationOptions(target) {
    const byId = new Map(getLocationCandidates(target).map((location) => [location.LocationId, location]));
    return recentLocations.value.map((id) => byId.get(id)).filter(Boolean).slice(0, 3);
  }
  function getLocationOptions(target) {
    const candidates = getLocationCandidates(target);
    const limited = candidates.slice(0, 50);
    const selectedId = selectedLocationIdForTarget(target);
    const selected = candidates.find((location) => location.LocationId === selectedId);
    if (selected && !limited.some((location) => location.LocationId === selectedId)) limited.push(selected);
    return limited;
  }
  function getLocationMenuRows(target) {
    const recentRows = getRecentLocationOptions(target).map((location) => ({
      Type: "location", Key: `recent-location:${location.LocationId}`, Label: location.Name, Depth: 0, Location: location,
    }));
    const rows = buildLocationHierarchyRows(getLocationOptions(target));
    if (!recentRows.length) return rows;
    return [
      { Type: "section", Key: "section:recent", Label: "最近使用", Depth: 0 }, ...recentRows,
      ...(rows.length ? [{ Type: "section", Key: "section:all", Label: "全部地点", Depth: 0 }, ...rows] : []),
    ];
  }
  function getLocationFilterRows(keywordValue = "") {
    const keyword = normalizeLocationName(keywordValue);
    const candidates = locationRegistry.value.filter((location) => locationMatchesKeyword(location, keyword)).sort(compareLocationsByRegionAndTree);
    const byId = new Map(candidates.map((location) => [location.LocationId, location]));
    const recentRows = recentLocations.value.map((id) => byId.get(id)).filter(Boolean).slice(0, 3).map((location) => ({
      Type: "location", Key: `filter-recent-location:${location.LocationId}`, Label: location.Name, Depth: 0, Location: location,
    }));
    const rows = buildLocationHierarchyRows(candidates);
    if (!recentRows.length) return rows;
    return [
      { Type: "section", Key: "filter-section:recent", Label: "最近使用", Depth: 0 }, ...recentRows,
      ...(rows.length ? [{ Type: "section", Key: "filter-section:all", Label: "全部地点", Depth: 0 }, ...rows] : []),
    ];
  }
  async function setLocationFilter(locationId) {
    query.filters.location = locationId || "";
    if (locationId) rememberRecentLocation(locationId);
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
    return locationRegistry.value
      .filter((location) => !excluded.has(location.LocationId))
      .filter((location) => locationMatchesKeyword(location, keyword))
      .sort(compareLocationsByRegionAndTree).slice(0, 50);
  }
  function getLocationParentRows(keywordValue = "", excludeId = "") {
    return buildLocationHierarchyRows(getLocationParentOptions(keywordValue, excludeId));
  }

  function openLocationDropdown(target) {
    const shouldOpen = !locationDropdown[target];
    closeOtherRegistryDropdowns?.();
    locationDropdown[target] = shouldOpen;
  }
  function closeLocationDropdown(target) { locationDropdown[target] = false; }
  function closeAllLocationDropdowns() {
    locationDropdown.viewer = false; locationDropdown.batch = false; locationCreate.parentDropdown = false;
  }
  function setLocationForTarget(target, locationId) {
    if (!getLocation(locationId)) return;
    if (target === "batch") batchEdit.locationId = locationId;
    else { editDraft.LocationId = locationId; requestEdit("Location"); }
    rememberRecentLocation(locationId);
    locationSearch[target] = "";
    closeLocationDropdown(target);
  }
  function clearLocationForTarget(target) {
    if (target === "batch") batchEdit.locationId = null;
    else { editDraft.LocationId = null; requestEdit("Location"); }
    locationSearch[target] = "";
    closeLocationDropdown(target);
  }
  function onLocationSearchKeydown(event, target) {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = getRecentLocationOptions(target)[0] || getLocationOptions(target)[0];
      if (first) setLocationForTarget(target, first.LocationId);
    } else if (event.key === "Escape") closeLocationDropdown(target);
    else if (event.key === "Backspace" && !locationSearch[target] && selectedLocationIdForTarget(target)) {
      event.preventDefault(); clearLocationForTarget(target);
    }
  }

  function resetLocationCreateState() {
    Object.assign(locationCreate, {
      visible: false, name: "", country: "", province: "", city: "", parentId: null,
      parentSearch: "", parentDropdown: false, description: "", error: "",
    });
  }
  function openCreateLocationMenu(target) {
    closeOtherRegistryDropdowns?.();
    const currentId = target === "manager" ? null : selectedLocationIdForTarget(target);
    const current = getLocation(currentId);
    Object.assign(locationCreate, {
      visible: true, target,
      name: target === "manager" ? "" : normalizeLocationName(locationSearch[target]),
      country: current?.Country || "", province: current?.Province || "", city: current?.City || "",
      parentId: currentId || null, parentSearch: "", parentDropdown: false, description: "", error: "",
    });
    if (target !== "manager") closeLocationDropdown(target);
  }
  function closeCreateLocationMenu() { resetLocationCreateState(); }
  function setCreateLocationParent(parentId) {
    locationCreate.parentId = parentId || null;
    locationCreate.parentSearch = "";
    locationCreate.parentDropdown = false;
  }
  function clearCreateLocationParent() { setCreateLocationParent(null); }
  async function createLocationAndSelect() {
    const name = normalizeLocationName(locationCreate.name);
    if (!name) { locationCreate.error = "地点名称不能为空"; return; }
    const result = await api.createLocation({
      name, country: locationCreate.country, province: locationCreate.province, city: locationCreate.city,
      parentId: locationCreate.parentId, description: locationCreate.description,
    });
    if (!result?.ok) { locationCreate.error = result?.error || "创建地点失败"; return; }
    applyLocationRegistry(result.locations);
    const target = locationCreate.target;
    if (target === "manager") { showToastMessage(`已创建地点“${result.location.Name}”`); scheduleLocationManagerContextUpdate(); }
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
    Object.assign(locationManager, {
      editingId: "", editCountry: "", editProvince: "", editCity: "",
      editParentId: null, editDescription: "", error: "",
    });
  }
  function closeLocationManager() {
    if (locationCreate.target === "manager") closeCreateLocationMenu();
    locationManager.visible = false; locationManager.search = ""; locationManagerContext.value = ""; cancelLocationEdit();
  }
  function startLocationEdit(location) {
    Object.assign(locationManager, {
      editingId: location.LocationId, editCountry: location.Country || "", editProvince: location.Province || "",
      editCity: location.City || "", editParentId: location.ParentId || null,
      editDescription: location.Description || "", error: "",
    });
  }
  async function saveLocationEdit() {
    const locationId = locationManager.editingId;
    if (!locationId) { locationManager.error = "地点不存在"; return; }
    const result = await api.updateLocation({
      locationId, country: locationManager.editCountry, province: locationManager.editProvince,
      city: locationManager.editCity, parentId: locationManager.editParentId,
      description: locationManager.editDescription,
    });
    if (!result?.ok) { locationManager.error = result?.error || "保存地点失败"; return; }
    applyLocationRegistry(result.locations); cancelLocationEdit(); showToastMessage("地点已更新");
  }

  function clearLocationFromItem(item, locationId) {
    return item?.Location?.LocationId === locationId ? { ...item, Location: { LocationId: null, Detail: "" } } : item;
  }
  function syncDeletedLocationLocally(locationId) {
    if (selectedItem.value) selectedItem.value = clearLocationFromItem(selectedItem.value, locationId);
    if (editDraft.LocationId === locationId) { editDraft.LocationId = null; editDraft.LocationDetail = ""; }
    if (batchEdit.locationId === locationId) batchEdit.locationId = null;
    orderedItems.value = orderedItems.value.map((item) => clearLocationFromItem(item, locationId));
    rebuildGalleryItemIndex();
    for (const group of galleryGroups.value) group.items = group.items.map((item) => galleryItemIndex.get(item.MediaId) || item);
    triggerRef(galleryGroups);
  }
  async function deleteLocationGlobally(location) {
    const usage = Number(location?.UsageCount || 0);
    const childCount = Array.isArray(location?.ChildrenIds) ? location.ChildrenIds.length : 0;
    if (!window.confirm(`确定全局删除地点“${location.Name}”？这会清空 ${usage} 个媒体的地点信息，并让 ${childCount} 个直接子地点变为无父节点。`)) return;
    const result = await api.deleteLocationGlobally({ locationId: location.LocationId });
    if (!result?.ok) { showToastMessage(`删除地点失败：${result?.error || "未知错误"}`); return; }
    applyLocationRegistry(result.locations);
    syncDeletedLocationLocally(location.LocationId);
    if (query.filters.location === location.LocationId) { query.filters.location = ""; await queryGallery(); }
    showToastMessage(`已全局删除地点“${location.Name}”`);
  }

  function resetLocationState() {
    locationRegistry.value = [];
    Object.assign(locationSearch, { viewer: "", batch: "" });
    closeAllLocationDropdowns(); resetLocationCreateState();
    Object.assign(locationManager, {
      visible: false, search: "", editingId: "", editCountry: "", editProvince: "",
      editCity: "", editParentId: null, editDescription: "", error: "",
    });
    locationManagerContext.value = "";
  }
  watch(() => [locationManager.visible, locationManager.search, managerLocationRows.value.length], scheduleLocationManagerContextUpdate);

  return {
    locationRegistry, locationSearch, locationDropdown, locationCreate, locationManager,
    locationManagerListRef, locationManagerContext, managerFilteredLocations, managerLocationRows,
    applyLocationRegistry, loadLocations, getLocationName, getLocationTreeLabel, getLocationTooltip,
    getLocationManagerRowContext, updateLocationManagerContext, scheduleLocationManagerContextUpdate,
    getLocationOptions, getRecentLocationOptions, getLocationMenuRows, getLocationFilterRows,
    setLocationFilter, getLocationParentOptions, getLocationParentRows, openLocationDropdown,
    closeLocationDropdown, closeAllLocationDropdowns, setLocationForTarget, clearLocationForTarget,
    onLocationSearchKeydown, openCreateLocationMenu, closeCreateLocationMenu,
    setCreateLocationParent, clearCreateLocationParent, createLocationAndSelect,
    openLocationManager, closeLocationManager, startLocationEdit, cancelLocationEdit,
    saveLocationEdit, deleteLocationGlobally, resetLocationState,
  };
}
