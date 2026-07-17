import { computed, reactive, ref, shallowRef } from "vue";
import {
  createDefaultGalleryFilters,
  hasNonDefaultGalleryControls,
  normalizeGalleryLevels,
  toggleGalleryLevel,
} from "../domain/gallery-filter-state.mjs";

/** Owns the complete gallery query result, indexes, and filters. */
export function useGalleryQuery({
  api,
  showToastMessage,
  onLocationsLoaded,
  onSelectionResultChanged,
  onResetSelection,
}) {
  const query = reactive({
    sortBy: "shootingTime",
    sortOrder: "desc",
    filters: createDefaultGalleryFilters(),
    search: { field: "title", value: "" },
  });
  const galleryControlsExpanded = ref(true);
  const galleryControlsModified = computed(() => hasNonDefaultGalleryControls(query));
  const galleryReturnMediaId = ref("");
  const galleryGroups = shallowRef([]);
  const orderedItems = shallowRef([]);
  const total = ref(0);
  const mediaCounts = reactive({ all: 0, images: 0, videos: 0 });
  const loading = ref(false);
  const filterOptions = reactive({ albums: [], tags: [], people: [], locations: [], unassignedAlbumCount: 0 });
  const galleryItemIndex = new Map();
  let latestQueryId = 0;

  function rebuildGalleryItemIndex() {
    galleryItemIndex.clear();
    for (const item of orderedItems.value) {
      if (item?.MediaId) galleryItemIndex.set(item.MediaId, item);
    }
  }

  async function queryGallery() {
    const requestId = ++latestQueryId;
    loading.value = true;
    try {
      const safeQuery = {
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
        filters: {
          mediaType: query.filters.mediaType,
          album: query.filters.album,
          tag: query.filters.tag,
          person: query.filters.person,
          location: query.filters.location,
          locationRegion: query.filters.locationRegion ? { ...query.filters.locationRegion } : null,
          ratingLevels: normalizeGalleryLevels(query.filters.ratingLevels),
          privacyLevels: normalizeGalleryLevels(query.filters.privacyLevels),
        },
        search: { field: query.search.field, value: query.search.value },
      };
      const response = await api.queryGallery(safeQuery);
      if (requestId !== latestQueryId) return false;
      total.value = Number(response?.total || 0);
      mediaCounts.all = Number(response?.mediaCounts?.all || 0);
      mediaCounts.images = Number(response?.mediaCounts?.images || 0);
      mediaCounts.videos = Number(response?.mediaCounts?.videos || 0);
      filterOptions.albums = Array.isArray(response?.filterOptions?.albums) ? response.filterOptions.albums : [];
      filterOptions.unassignedAlbumCount = Number(response?.filterOptions?.unassignedAlbumCount || 0);
      filterOptions.tags = Array.isArray(response?.filterOptions?.tags) ? response.filterOptions.tags : [];
      filterOptions.people = Array.isArray(response?.filterOptions?.people) ? response.filterOptions.people : [];
      onLocationsLoaded?.(Array.isArray(response?.filterOptions?.locations) ? response.filterOptions.locations : []);

      galleryGroups.value = Array.isArray(response?.groups) ? response.groups : [];
      orderedItems.value = galleryGroups.value.flatMap((group) => group.items);
      rebuildGalleryItemIndex();
      onSelectionResultChanged?.();
      return true;
    } catch (error) {
      if (requestId === latestQueryId) {
        showToastMessage(`加载画廊失败：${error?.message || "未知错误"}`);
      }
      return false;
    } finally {
      if (requestId === latestQueryId) loading.value = false;
    }
  }

  async function applySearch() { await queryGallery(); }
  async function applyFilterSort() { await queryGallery(); }

  async function setMediaTypeFilter(type) {
    query.filters.mediaType = type === "image" || type === "video" ? type : "";
    await queryGallery();
  }

  async function setAllGalleryLevels(filterKey) {
    if (filterKey !== "ratingLevels" && filterKey !== "privacyLevels") return;
    query.filters[filterKey] = [];
    await queryGallery();
  }

  async function toggleGalleryLevelFilter(filterKey, level) {
    if (filterKey !== "ratingLevels" && filterKey !== "privacyLevels") return;
    query.filters[filterKey] = toggleGalleryLevel(query.filters[filterKey], level);
    await queryGallery();
  }

  function toggleGalleryControls() {
    galleryControlsExpanded.value = !galleryControlsExpanded.value;
  }

  function requestGalleryReturn(mediaId) {
    galleryReturnMediaId.value = String(mediaId || "").trim();
  }

  function consumeGalleryReturnMediaId() {
    const mediaId = galleryReturnMediaId.value;
    galleryReturnMediaId.value = "";
    return mediaId;
  }

  async function resetAll() {
    Object.assign(query.filters, createDefaultGalleryFilters());
    Object.assign(query.search, { field: "title", value: "" });
    query.sortBy = "shootingTime";
    query.sortOrder = "desc";
    onResetSelection?.();
    await queryGallery();
  }

  function resetGalleryState() {
    latestQueryId += 1;
    loading.value = false;
    Object.assign(query.filters, createDefaultGalleryFilters());
    Object.assign(query.search, { field: "title", value: "" });
    query.sortBy = "shootingTime";
    query.sortOrder = "desc";
    galleryControlsExpanded.value = true;
    galleryReturnMediaId.value = "";
    galleryGroups.value = [];
    orderedItems.value = [];
    galleryItemIndex.clear();
    total.value = 0;
    Object.assign(mediaCounts, { all: 0, images: 0, videos: 0 });
    Object.assign(filterOptions, { albums: [], tags: [], people: [], locations: [], unassignedAlbumCount: 0 });
  }

  return {
    query,
    galleryControlsExpanded,
    galleryControlsModified,
    galleryGroups,
    orderedItems,
    total,
    mediaCounts,
    loading,
    filterOptions,
    galleryItemIndex,
    queryGallery,
    applySearch,
    applyFilterSort,
    setMediaTypeFilter,
    setAllGalleryLevels,
    toggleGalleryLevelFilter,
    toggleGalleryControls,
    requestGalleryReturn,
    consumeGalleryReturnMediaId,
    resetAll,
    resetGalleryState,
    rebuildGalleryItemIndex,
  };
}
