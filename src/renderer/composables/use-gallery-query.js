import { reactive, ref, shallowRef, triggerRef } from "vue";

/** Owns the complete gallery query result, indexes, filters, and thumbnail refresh events. */
export function useGalleryQuery({
  api,
  selectedItem,
  showToastMessage,
  onLocationsLoaded,
  onSelectionResultChanged,
  onResetSelection,
}) {
  const query = reactive({
    sortBy: "shootingTime",
    sortOrder: "desc",
    filters: { mediaType: "", album: "", tag: "", person: "", location: "" },
    search: { field: "title", value: "" },
  });
  const galleryGroups = shallowRef([]);
  const orderedItems = shallowRef([]);
  const total = ref(0);
  const mediaCounts = reactive({ all: 0, images: 0, videos: 0 });
  const loading = ref(false);
  const filterOptions = reactive({ albums: [], tags: [], people: [], locations: [], unassignedAlbumCount: 0 });
  const galleryItemIndex = new Map();
  let latestQueryId = 0;
  let removeThumbnailReadyListener = null;

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

  async function resetAll() {
    Object.assign(query.filters, { mediaType: "", album: "", tag: "", person: "", location: "" });
    Object.assign(query.search, { field: "title", value: "" });
    query.sortBy = "shootingTime";
    query.sortOrder = "desc";
    onResetSelection?.();
    await queryGallery();
  }

  function resetGalleryState() {
    latestQueryId += 1;
    loading.value = false;
    Object.assign(query.filters, { mediaType: "", album: "", tag: "", person: "", location: "" });
    Object.assign(query.search, { field: "title", value: "" });
    galleryGroups.value = [];
    orderedItems.value = [];
    galleryItemIndex.clear();
    total.value = 0;
    Object.assign(mediaCounts, { all: 0, images: 0, videos: 0 });
    Object.assign(filterOptions, { albums: [], tags: [], people: [], locations: [], unassignedAlbumCount: 0 });
  }

  function markThumbnailReady(payload) {
    const mediaId = String(payload?.mediaId || "");
    if (!mediaId) return;
    const readyAt = Date.now();
    const update = (item) => {
      if (!item || item.MediaId !== mediaId) return;
      item.__thumbnailPath = payload.thumbnailPath || item.__thumbnailPath;
      item.__thumbnailAvailable = true;
      item.__thumbnailReadyAt = readyAt;
    };
    update(selectedItem.value);
    update(galleryItemIndex.get(mediaId));
    triggerRef(orderedItems);
    triggerRef(galleryGroups);
  }

  function initialize() {
    if (typeof api.onThumbnailReady === "function") {
      removeThumbnailReadyListener = api.onThumbnailReady(markThumbnailReady);
    }
  }

  function dispose() {
    if (typeof removeThumbnailReadyListener === "function") removeThumbnailReadyListener();
  }

  return {
    query,
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
    resetAll,
    resetGalleryState,
    rebuildGalleryItemIndex,
    initialize,
    dispose,
  };
}
