import { computed, nextTick, reactive, ref, triggerRef, watch } from "vue";
import {
  buildLocationHierarchyRows,
  compareLocationsByRegionAndTree,
  getLocationManagerRowContext,
  getLocationPathLabel,
  getLocationRegionLabel,
  getLocationRegionParts,
  locationMatchesKeyword,
  normalizeLocationField,
  normalizeLocationName,
} from "../domain/location-hierarchy.mjs";

/** Owns hierarchical location pickers, dynamic context, and location registry mutations. */
export function useLocationRegistry({
  api,
  filterOptions,
  query,
  editDraft,
  batchEdit,
  selectedItem,
  orderedItems,
  galleryGroups,
  gallerySettingsOpen,
  recentLocations,
  rememberRecentLocation,
  pruneRecentLocations,
  showToastMessage,
  closeOtherRegistryDropdowns,
  requestEdit,
  rebuildGalleryItemIndex,
  galleryItemIndex,
  queryGallery,
  applyFilterSort,
}) {
  const locationRegistry = ref([]);
  const locationSearch = reactive({ viewer: "", batch: "" });
  const locationDropdown = reactive({ viewer: false, batch: false });
  const locationCreate = reactive({
    visible: false,
    target: "viewer",
    name: "",
    country: "",
    province: "",
    city: "",
    parent: "",
    parentSearch: "",
    parentDropdown: false,
    description: "",
    error: "",
  });
  const locationManager = reactive({
    visible: false,
    search: "",
    editingName: "",
    editCountry: "",
    editProvince: "",
    editCity: "",
    editParent: "",
    editDescription: "",
    error: "",
  });
  const locationManagerListRef = ref(null);
  const locationManagerContext = ref("");

  const managerFilteredLocations = computed(() => {
    const keyword = locationManager.search.trim();
    return keyword
      ? locationRegistry.value.filter((location) => locationMatchesKeyword(location, keyword))
      : [...locationRegistry.value];
  });
  const managerLocationRows = computed(() => buildLocationHierarchyRows(managerFilteredLocations.value));

  function applyLocationRegistry(locations) {
    locationRegistry.value = (Array.isArray(locations) ? locations : [])
      .map((location) => ({
        Name: normalizeLocationName(location?.Name),
        Country: normalizeLocationField(location?.Country),
        Province: normalizeLocationField(location?.Province),
        City: normalizeLocationField(location?.City),
        Parent: normalizeLocationName(location?.Parent),
        Description: normalizeLocationField(location?.Description),
        CreatedAt: location?.CreatedAt || "",
        UpdatedAt: location?.UpdatedAt || "",
        UsageCount: Number(location?.UsageCount || 0),
        Children: Array.isArray(location?.Children) ? location.Children : [],
        Depth: Number(location?.Depth || 0),
        Path: Array.isArray(location?.Path) ? location.Path : [],
      }))
      .filter((location) => location.Name)
      .sort(compareLocationsByRegionAndTree);
    filterOptions.locations = locationRegistry.value;
    pruneRecentLocations(locationRegistry.value.map((location) => location.Name));
    if (query.filters.location && !locationRegistry.value.some((location) => location.Name === query.filters.location)) {
      query.filters.location = "";
    }
  }

  async function loadLocations() {
    if (typeof api.listLocations !== "function") return;
    const result = await api.listLocations();
    if (result?.ok) applyLocationRegistry(result.locations);
  }

  function selectedLocationForTarget(target) {
    return target === "batch" ? batchEdit.locationPlace : editDraft.LocationPlace;
  }

  function getLocationTreeLabel(location) {
    const region = getLocationRegionLabel(location);
    return `${"　".repeat(Number(location?.Depth || 0))}${location?.Name || ""}${region ? ` - ${region}` : ""}`;
  }

  function getLocationTooltip(locationName) {
    const location = locationRegistry.value.find((item) => item.Name === locationName);
    if (!location) return "";
    return [getLocationRegionLabel(location), getLocationPathLabel(location), location.Description].filter(Boolean).join("\n");
  }

  function getLocationSummary(location) {
    const region = getLocationRegionLabel(location) || "未设置行政区";
    const parent = location.Parent ? `父节点：${location.Parent}` : "无父节点";
    return `${region}；${parent}；${location.Description || "无说明"}`;
  }

  function updateLocationManagerContext() {
    const list = locationManagerListRef.value;
    if (!list) {
      locationManagerContext.value = "";
      return;
    }
    const listTop = list.getBoundingClientRect().top;
    const items = [...list.querySelectorAll(".location-manager-item[data-location-context]")];
    let current = null;
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      if (rect.top <= listTop + 1 && rect.bottom > listTop) current = item;
      else if (!current && rect.top > listTop) {
        current = item;
        break;
      }
    }
    locationManagerContext.value = current?.dataset?.locationContext || "";
  }

  function scheduleLocationManagerContextUpdate() {
    if (locationManager.visible) nextTick(updateLocationManagerContext);
  }

  function getLocationCandidates(target) {
    const keyword = normalizeLocationName(locationSearch[target]);
    return locationRegistry.value
      .filter((location) => locationMatchesKeyword(location, keyword))
      .sort(compareLocationsByRegionAndTree);
  }

  function getRecentLocationOptions(target) {
    const byName = new Map(getLocationCandidates(target).map((location) => [location.Name, location]));
    return recentLocations.value.map((name) => byName.get(name)).filter(Boolean).slice(0, 3);
  }

  function getLocationOptions(target) {
    const candidates = getLocationCandidates(target);
    const limited = candidates.slice(0, 50);
    const selected = selectedLocationForTarget(target);
    const selectedLocation = candidates.find((location) => location.Name === selected);
    if (selectedLocation && !limited.some((location) => location.Name === selected)) limited.push(selectedLocation);
    return limited;
  }

  function getLocationMenuRows(target) {
    const recentRows = getRecentLocationOptions(target).map((location) => ({
      Type: "location",
      Key: `recent-location:${location.Name}`,
      Label: location.Name,
      Depth: 0,
      Location: location,
    }));
    const locationRows = buildLocationHierarchyRows(getLocationOptions(target));
    if (!recentRows.length) return locationRows;
    return [
      { Type: "section", Key: "section:recent", Label: "最近使用", Depth: 0 },
      ...recentRows,
      ...(locationRows.length ? [{ Type: "section", Key: "section:all", Label: "全部地点", Depth: 0 }, ...locationRows] : []),
    ];
  }

  function getLocationFilterRows(keywordValue = "") {
    const keyword = normalizeLocationName(keywordValue);
    const candidates = locationRegistry.value
      .filter((location) => locationMatchesKeyword(location, keyword))
      .sort(compareLocationsByRegionAndTree);
    const byName = new Map(candidates.map((location) => [location.Name, location]));
    const recentRows = recentLocations.value
      .map((name) => byName.get(name))
      .filter(Boolean)
      .slice(0, 3)
      .map((location) => ({
        Type: "location",
        Key: `filter-recent-location:${location.Name}`,
        Label: location.Name,
        Depth: 0,
        Location: location,
      }));
    const locationRows = buildLocationHierarchyRows(candidates);
    if (!recentRows.length) return locationRows;
    return [
      { Type: "section", Key: "filter-section:recent", Label: "最近使用", Depth: 0 },
      ...recentRows,
      ...(locationRows.length ? [{ Type: "section", Key: "filter-section:all", Label: "全部地点", Depth: 0 }, ...locationRows] : []),
    ];
  }

  async function setLocationFilter(rawName) {
    const name = normalizeLocationName(rawName);
    query.filters.location = name;
    if (name) rememberRecentLocation(name);
    await applyFilterSort();
  }

  function getLocationParentOptions(keywordValue = "", excludeName = "") {
    const keyword = normalizeLocationName(keywordValue);
    const exclude = normalizeLocationName(excludeName);
    const excluded = new Set([exclude]);
    const source = locationRegistry.value;
    const children = new Map(source.map((location) => [location.Name, []]));
    for (const location of source) {
      if (location.Parent && children.has(location.Parent)) children.get(location.Parent).push(location.Name);
    }
    const stack = [...(children.get(exclude) || [])];
    while (stack.length) {
      const current = stack.pop();
      if (!current || excluded.has(current)) continue;
      excluded.add(current);
      stack.push(...(children.get(current) || []));
    }
    return source
      .filter((location) => !excluded.has(location.Name))
      .filter((location) => locationMatchesKeyword(location, keyword))
      .sort(compareLocationsByRegionAndTree)
      .slice(0, 50);
  }

  function getLocationParentRows(keywordValue = "", excludeName = "") {
    return buildLocationHierarchyRows(getLocationParentOptions(keywordValue, excludeName));
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
    locationCreate.parentDropdown = false;
  }

  function setLocationForTarget(target, rawName) {
    const name = normalizeLocationName(rawName);
    if (!name) return;
    if (target === "batch") batchEdit.locationPlace = name;
    else {
      editDraft.LocationPlace = name;
      requestEdit("Location");
    }
    rememberRecentLocation(name);
    locationSearch[target] = "";
    closeLocationDropdown(target);
  }

  function clearLocationForTarget(target) {
    if (target === "batch") batchEdit.locationPlace = "";
    else {
      editDraft.LocationPlace = "";
      requestEdit("Location");
    }
    locationSearch[target] = "";
    closeLocationDropdown(target);
  }

  function onLocationSearchKeydown(event, target) {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = getRecentLocationOptions(target)[0] || getLocationOptions(target)[0];
      if (first) setLocationForTarget(target, first.Name);
      return;
    }
    if (event.key === "Escape") {
      closeLocationDropdown(target);
      return;
    }
    if (event.key === "Backspace" && !locationSearch[target] && selectedLocationForTarget(target)) {
      event.preventDefault();
      clearLocationForTarget(target);
    }
  }

  function resetLocationCreateState() {
    Object.assign(locationCreate, {
      visible: false,
      name: "",
      country: "",
      province: "",
      city: "",
      parent: "",
      parentSearch: "",
      parentDropdown: false,
      description: "",
      error: "",
    });
  }

  function openCreateLocationMenu(target) {
    closeOtherRegistryDropdowns?.();
    locationCreate.visible = true;
    locationCreate.target = target;
    locationCreate.name = target === "manager" ? "" : normalizeLocationName(locationSearch[target]);
    const current = target === "manager" ? "" : selectedLocationForTarget(target);
    const currentLocation = locationRegistry.value.find((location) => location.Name === current);
    locationCreate.country = currentLocation?.Country || "";
    locationCreate.province = currentLocation?.Province || "";
    locationCreate.city = currentLocation?.City || "";
    locationCreate.parent = current || "";
    locationCreate.parentSearch = "";
    locationCreate.parentDropdown = false;
    locationCreate.description = "";
    locationCreate.error = "";
    if (target !== "manager") closeLocationDropdown(target);
  }

  function closeCreateLocationMenu() { resetLocationCreateState(); }

  function setCreateLocationParent(parent) {
    locationCreate.parent = normalizeLocationName(parent);
    locationCreate.parentSearch = "";
    locationCreate.parentDropdown = false;
  }

  function clearCreateLocationParent() {
    locationCreate.parent = "";
    locationCreate.parentSearch = "";
    locationCreate.parentDropdown = false;
  }

  async function createLocationAndSelect() {
    const name = normalizeLocationName(locationCreate.name);
    if (!name) {
      locationCreate.error = "地点名称不能为空";
      return;
    }
    const result = await api.createLocation({
      name,
      country: locationCreate.country,
      province: locationCreate.province,
      city: locationCreate.city,
      parent: locationCreate.parent,
      description: locationCreate.description,
    });
    if (!result?.ok) {
      locationCreate.error = result?.error || "创建地点失败";
      return;
    }
    applyLocationRegistry(result.locations);
    const target = locationCreate.target;
    if (target === "manager") {
      showToastMessage(`已创建地点“${result.location.Name}”`);
      scheduleLocationManagerContextUpdate();
    } else {
      setLocationForTarget(target, result.location.Name);
    }
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
      editingName: "",
      editCountry: "",
      editProvince: "",
      editCity: "",
      editParent: "",
      editDescription: "",
      error: "",
    });
  }

  function closeLocationManager() {
    if (locationCreate.target === "manager") closeCreateLocationMenu();
    locationManager.visible = false;
    locationManager.search = "";
    locationManagerContext.value = "";
    cancelLocationEdit();
  }

  function startLocationEdit(location) {
    Object.assign(locationManager, {
      editingName: location.Name,
      editCountry: location.Country || "",
      editProvince: location.Province || "",
      editCity: location.City || "",
      editParent: location.Parent || "",
      editDescription: location.Description || "",
      error: "",
    });
  }

  async function saveLocationEdit() {
    const name = locationManager.editingName;
    if (!name) {
      locationManager.error = "地点不存在";
      return;
    }
    const result = await api.updateLocation({
      name,
      country: locationManager.editCountry,
      province: locationManager.editProvince,
      city: locationManager.editCity,
      parent: locationManager.editParent,
      description: locationManager.editDescription,
    });
    if (!result?.ok) {
      locationManager.error = result?.error || "保存地点失败";
      return;
    }
    applyLocationRegistry(result.locations);
    cancelLocationEdit();
    showToastMessage("地点已更新");
  }

  function clearLocationFromItem(item, locationName) {
    const current = normalizeLocationName(item?.Location?.Place || item?.Location?.Site);
    return current === locationName ? { ...item, Location: { Place: "", Detail: "" } } : item;
  }

  function syncDeletedLocationLocally(locationName) {
    if (selectedItem.value) selectedItem.value = clearLocationFromItem(selectedItem.value, locationName);
    if (editDraft.LocationPlace === locationName) {
      editDraft.LocationPlace = "";
      editDraft.LocationDetail = "";
    }
    if (batchEdit.locationPlace === locationName) batchEdit.locationPlace = "";
    orderedItems.value = orderedItems.value.map((item) => clearLocationFromItem(item, locationName));
    rebuildGalleryItemIndex();
    for (const group of galleryGroups.value) {
      group.items = group.items.map((item) => galleryItemIndex.get(item.FilePath) || item);
    }
    triggerRef(galleryGroups);
  }

  async function deleteLocationGlobally(location) {
    const usage = Number(location?.UsageCount || 0);
    const childCount = Array.isArray(location?.Children) ? location.Children.length : 0;
    if (!window.confirm(`确定全局删除地点“${location.Name}”？这会清空 ${usage} 个媒体的地点信息，并让 ${childCount} 个直接子地点变为无父节点。`)) return;
    const result = await api.deleteLocationGlobally({ name: location.Name });
    if (!result?.ok) {
      showToastMessage(`删除地点失败：${result?.error || "未知错误"}`);
      return;
    }
    applyLocationRegistry(result.locations);
    syncDeletedLocationLocally(location.Name);
    if (query.filters.location === location.Name) {
      query.filters.location = "";
      await queryGallery();
    }
    showToastMessage(`已全局删除地点“${location.Name}”`);
  }

  function resetLocationState() {
    locationRegistry.value = [];
    Object.assign(locationSearch, { viewer: "", batch: "" });
    closeAllLocationDropdowns();
    resetLocationCreateState();
    Object.assign(locationManager, {
      visible: false,
      search: "",
      editingName: "",
      editCountry: "",
      editProvince: "",
      editCity: "",
      editParent: "",
      editDescription: "",
      error: "",
    });
    locationManagerContext.value = "";
  }

  watch(
    () => [locationManager.visible, locationManager.search, managerLocationRows.value.length],
    scheduleLocationManagerContextUpdate,
  );

  return {
    locationRegistry,
    locationSearch,
    locationDropdown,
    locationCreate,
    locationManager,
    locationManagerListRef,
    locationManagerContext,
    managerFilteredLocations,
    managerLocationRows,
    applyLocationRegistry,
    loadLocations,
    getLocationTreeLabel,
    getLocationTooltip,
    getLocationSummary,
    getLocationManagerRowContext,
    updateLocationManagerContext,
    scheduleLocationManagerContextUpdate,
    getLocationOptions,
    getRecentLocationOptions,
    getLocationMenuRows,
    getLocationFilterRows,
    setLocationFilter,
    getLocationParentOptions,
    getLocationParentRows,
    openLocationDropdown,
    closeLocationDropdown,
    closeAllLocationDropdowns,
    setLocationForTarget,
    clearLocationForTarget,
    onLocationSearchKeydown,
    openCreateLocationMenu,
    closeCreateLocationMenu,
    setCreateLocationParent,
    clearCreateLocationParent,
    createLocationAndSelect,
    openLocationManager,
    closeLocationManager,
    startLocationEdit,
    cancelLocationEdit,
    saveLocationEdit,
    deleteLocationGlobally,
    resetLocationState,
  };
}
