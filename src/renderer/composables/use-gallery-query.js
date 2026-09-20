import { computed, reactive, ref, shallowRef, onScopeDispose } from "vue";
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
  const appliedSearch = ref({ field: 'title', value: '' });
  const resultLimit = ref(10);
  const semanticActive = ref(false);
  const searchError = ref('');
  const appliedSearchLabel = computed(() => appliedSearch.value.value
    ? `${{ title: 'Title', filename: 'File name', description: 'Description', semantic: 'Semantic' }[appliedSearch.value.field]}: ${appliedSearch.value.value}` : '');
  const galleryControlsModified = computed(() => hasNonDefaultGalleryControls({ ...query, search: appliedSearch.value }));
  const galleryReturnMediaId = ref("");
  const galleryGroups = shallowRef([]);
  const orderedItems = shallowRef([]);
  const total = ref(0);
  const loading = ref(false);
  let latestQueryId = 0;
  let pendingSearch = null;
  let alive = true;

  function clearResults() {
    galleryGroups.value = [];
    orderedItems.value = [];
    total.value = 0;
    onSelectionResultChanged?.();
  }

  async function queryGallery() {
    const requestId = ++latestQueryId;
    const candidate = { ...(pendingSearch || appliedSearch.value) };
    loading.value = true;
    searchError.value = '';
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
        search: candidate,
        resultLimit: resultLimit.value,
      };
      const response = await api.queryGallery(safeQuery);
      if (!alive || requestId !== latestQueryId) return false;
      appliedSearch.value = candidate;
      pendingSearch = null;
      semanticActive.value = Boolean(response?.semantic);
      total.value = Number(response?.total || 0);

      galleryGroups.value = Array.isArray(response?.groups) ? response.groups : [];
      orderedItems.value = galleryGroups.value.flatMap((group) => group.items);
      onSelectionResultChanged?.();
      return true;
    } catch (error) {
      if (alive && requestId === latestQueryId) {
        pendingSearch = null;
        searchError.value = String(error?.message || 'Unknown error');
        showToastMessage(`Could not load gallery: ${error?.message || "Unknown error"}`);
      }
      return false;
    } finally {
      if (alive && requestId === latestQueryId) loading.value = false;
    }
  }

  async function applySearch() {
    const value = query.search.value;
    pendingSearch = { field: query.search.field, value: value.trim() ? (query.search.field === 'semantic' ? value.normalize('NFC').trim() : value) : '' };
    await queryGallery();
  }
  function submitSearchKey(event) {
    if (event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    return applySearch();
  }
  async function stopSearch() {
    const revision = ++latestQueryId;
    pendingSearch = null;
    loading.value = false;
    await api.cancelGallerySearch?.();
    if (!alive || revision !== latestQueryId) return;
    await queryGallery();
  }
  async function clearSearch() {
    const revision = ++latestQueryId;
    pendingSearch = null;
    query.search.value = '';
    appliedSearch.value = { field: query.search.field, value: '' };
    semanticActive.value = false;
    await api.cancelGallerySearch?.();
    if (!alive || revision !== latestQueryId) return;
    await queryGallery();
  }
  async function setResultLimit(event) {
    const value = Number(event.target.value);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      event.target.value = resultLimit.value;
      return;
    }
    resultLimit.value = value;
    if (appliedSearch.value.field === 'semantic' && appliedSearch.value.value) await queryGallery();
  }
  async function applyFilterSort() { clearResults(); await queryGallery(); }

  async function setMediaTypeFilter(type) {
    query.filters.mediaType = type === "image" || type === "video" ? type : "";
    await applyFilterSort();
  }

  async function setAllGalleryLevels(filterKey) {
    if (filterKey !== "ratingLevels" && filterKey !== "privacyLevels") return;
    query.filters[filterKey] = [];
    await applyFilterSort();
  }

  async function toggleGalleryLevelFilter(filterKey, level) {
    if (filterKey !== "ratingLevels" && filterKey !== "privacyLevels") return;
    query.filters[filterKey] = toggleGalleryLevel(query.filters[filterKey], level);
    await applyFilterSort();
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
    const revision = ++latestQueryId;
    pendingSearch = null;
    resultLimit.value = 10;
    semanticActive.value = false;
    appliedSearch.value = { field: 'title', value: '' };
    Object.assign(query.filters, createDefaultGalleryFilters());
    Object.assign(query.search, { field: "title", value: "" });
    query.sortBy = "shootingTime";
    query.sortOrder = "desc";
    onResetSelection?.();
    clearResults();
    await api.cancelGallerySearch?.();
    if (!alive || revision !== latestQueryId) return;
    await queryGallery();
  }

  function resetGalleryState() {
    latestQueryId += 1;
    pendingSearch = null;
    appliedSearch.value = { field: 'title', value: '' };
    resultLimit.value = 10;
    semanticActive.value = false;
    searchError.value = '';
    loading.value = false;
    Object.assign(query.filters, createDefaultGalleryFilters());
    Object.assign(query.search, { field: "title", value: "" });
    query.sortBy = "shootingTime";
    query.sortOrder = "desc";
    galleryControlsExpanded.value = true;
    galleryReturnMediaId.value = "";
    galleryGroups.value = [];
    orderedItems.value = [];
    total.value = 0;
  }

  onScopeDispose(() => {
    alive = false;
    latestQueryId++;
    void api.cancelGallerySearch?.().catch(() => {});
  });

  return {
    query,
    appliedSearchLabel, resultLimit, semanticActive, searchError,
    submitSearchKey, stopSearch, clearSearch, setResultLimit,
    galleryControlsExpanded,
    galleryControlsModified,
    galleryGroups,
    orderedItems,
    total,
    loading,
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
  };
}
