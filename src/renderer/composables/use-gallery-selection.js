import { computed, reactive, ref, triggerRef } from "vue";

/** Owns gallery selection and the batch-edit transaction built on the complete query result. */
export function useGallerySelection({
  api,
  orderedItems,
  galleryGroups,
  rebuildGalleryItemIndex,
  showToastMessage,
  openViewer,
  getBatchTagOptions,
  addBatchTagOption,
  handleBatchTagKeydown,
  resetBatchPickers,
  refreshRegistries,
}) {
  const isSelectionMode = ref(false);
  const gallerySelection = ref(new Set());
  const batchEdit = reactive({ title: "", rating: null, privacy: null, albumId: null, tagIds: [], personIds: [], locationId: null });
  const batchStatus = reactive({ visible: false, tone: "info", message: "" });

  const selectedGalleryCount = computed(() => gallerySelection.value.size);
  const batchHasChanges = computed(() => (
    Boolean(batchEdit.title.trim())
    || batchEdit.rating !== null
    || batchEdit.privacy !== null
    || Boolean(batchEdit.albumId)
    || batchEdit.tagIds.length > 0
    || batchEdit.personIds.length > 0
    || Boolean(batchEdit.locationId)
  ));
  const canApplyBatchEdit = computed(() => selectedGalleryCount.value > 0 && batchHasChanges.value);

  function enterSelectionMode() {
    isSelectionMode.value = true;
  }

  function exitSelectionMode() {
    isSelectionMode.value = false;
    clearGallerySelection();
    clearBatchEditInputs();
  }

  function onGalleryCardClick(item) {
    if (isSelectionMode.value) {
      toggleGallerySelection(item.MediaId);
      return;
    }
    openViewer?.(item);
  }

  function isGallerySelected(mediaId) {
    return gallerySelection.value.has(mediaId);
  }

  function toggleGallerySelection(mediaId) {
    const next = new Set(gallerySelection.value);
    if (next.has(mediaId)) next.delete(mediaId);
    else next.add(mediaId);
    gallerySelection.value = next;
  }

  function clearGallerySelection() {
    gallerySelection.value = new Set();
  }

  function selectAllGalleryPhotos() {
    if (!isSelectionMode.value) return;
    const all = orderedItems.value.map((item) => item.MediaId).filter(Boolean);
    gallerySelection.value = new Set(all);
  }

  function syncGallerySelectionWithLoadedItems() {
    const available = new Set(orderedItems.value.map((item) => item.MediaId));
    const next = new Set([...gallerySelection.value].filter((mediaId) => available.has(mediaId)));
    if (next.size !== gallerySelection.value.size) gallerySelection.value = next;
  }

  function addBatchTag() {
    const first = getBatchTagOptions?.()[0];
    if (first) addBatchTagOption?.(first.TagId);
  }

  function setBatchStatus(tone, message) {
    batchStatus.visible = true;
    batchStatus.tone = tone;
    batchStatus.message = message;
  }

  function clearBatchEditInputs({ keepStatus = false } = {}) {
    Object.assign(batchEdit, { title: "", rating: null, privacy: null, albumId: null, tagIds: [], personIds: [], locationId: null });
    resetBatchPickers?.();
    if (!keepStatus) {
      batchStatus.visible = false;
      batchStatus.message = "";
    }
  }

  function resetSelectionState() {
    gallerySelection.value = new Set();
    isSelectionMode.value = false;
    clearBatchEditInputs();
  }

  function syncUpdatedItemsIntoGallery(updatedItems) {
    const byId = new Map(updatedItems.map((item) => [item.MediaId, item]));
    orderedItems.value = orderedItems.value.map((item) => byId.get(item.MediaId) || item);
    for (const group of galleryGroups.value) {
      group.items = group.items.map((item) => byId.get(item.MediaId) || item);
    }
    rebuildGalleryItemIndex();
    triggerRef(galleryGroups);
  }

  function removeBatchTagAt(index) {
    if (index >= 0 && index < batchEdit.tagIds.length) batchEdit.tagIds.splice(index, 1);
  }

  function removeBatchPersonAt(index) {
    if (index >= 0 && index < batchEdit.personIds.length) batchEdit.personIds.splice(index, 1);
  }

  function onBatchTagInputKeydown(event) {
    handleBatchTagKeydown?.(event);
  }

  async function applyBatchEdit() {
    const mediaIds = [...gallerySelection.value];
    if (!mediaIds.length) {
      showToastMessage("请先选择媒体");
      return;
    }

    const locationPatch = {};
    if (batchEdit.locationId) locationPatch.LocationId = batchEdit.locationId;
    const customizationPatch = {};
    if (batchEdit.title.trim()) customizationPatch.Title = batchEdit.title.trim();
    if (batchEdit.rating !== null) customizationPatch.Rating = batchEdit.rating;
    if (batchEdit.privacy !== null) customizationPatch.Privacy = batchEdit.privacy;
    if (batchEdit.albumId) customizationPatch.AlbumId = batchEdit.albumId;
    const addTagIds = [...new Set(batchEdit.tagIds.filter(Boolean))];
    const addPersonIds = [...new Set(batchEdit.personIds.filter(Boolean))];
    if (!addTagIds.length && !addPersonIds.length && !Object.keys(locationPatch).length && !Object.keys(customizationPatch).length) {
      showToastMessage("请先填写要批量修改的内容");
      return;
    }

    const result = await api.batchUpdateMetadata({ mediaIds, addTagIds, addPersonIds, locationPatch, customizationPatch });
    if (!result?.ok) {
      const message = `批量修改失败：${result?.error || "未知错误"}`;
      showToastMessage(message);
      setBatchStatus("error", message);
      return;
    }

    const updatedItems = Array.isArray(result.items) ? result.items : [];
    syncUpdatedItemsIntoGallery(updatedItems);
    await refreshRegistries?.();
    const updatedCount = Number(result.updatedCount || updatedItems.length || 0);
    const missingCount = Number(result.missingCount || 0);
    const requestedCount = Number(result.requestedCount || mediaIds.length || 0);
    const detail = missingCount > 0
      ? `批量修改完成：成功 ${updatedCount} 个，失败 ${missingCount} 个（请求 ${requestedCount} 个）`
      : `批量修改完成：成功 ${updatedCount} 个媒体`;
    showToastMessage(detail);
    clearBatchEditInputs({ keepStatus: true });
    setBatchStatus(missingCount > 0 ? "warning" : "success", detail);
  }

  return {
    isSelectionMode,
    gallerySelection,
    batchEdit,
    batchStatus,
    selectedGalleryCount,
    batchHasChanges,
    canApplyBatchEdit,
    enterSelectionMode,
    exitSelectionMode,
    onGalleryCardClick,
    isGallerySelected,
    toggleGallerySelection,
    clearGallerySelection,
    selectAllGalleryPhotos,
    syncGallerySelectionWithLoadedItems,
    addBatchTag,
    setBatchStatus,
    clearBatchEditInputs,
    resetSelectionState,
    syncUpdatedItemsIntoGallery,
    removeBatchTagAt,
    removeBatchPersonAt,
    onBatchTagInputKeydown,
    applyBatchEdit,
  };
}
