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
  const batchEdit = reactive({ title: "", rating: null, privacy: null, album: "", tags: [], people: [], locationPlace: "" });
  const batchStatus = reactive({ visible: false, tone: "info", message: "" });

  const selectedGalleryCount = computed(() => gallerySelection.value.size);
  const batchHasChanges = computed(() => (
    Boolean(batchEdit.title.trim())
    || batchEdit.rating !== null
    || batchEdit.privacy !== null
    || Boolean(batchEdit.album.trim())
    || batchEdit.tags.length > 0
    || batchEdit.people.length > 0
    || Boolean(batchEdit.locationPlace.trim())
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
      toggleGallerySelection(item.FilePath);
      return;
    }
    openViewer?.(item);
  }

  function isGallerySelected(filePath) {
    return gallerySelection.value.has(filePath);
  }

  function toggleGallerySelection(filePath) {
    const next = new Set(gallerySelection.value);
    if (next.has(filePath)) next.delete(filePath);
    else next.add(filePath);
    gallerySelection.value = next;
  }

  function clearGallerySelection() {
    gallerySelection.value = new Set();
  }

  function selectAllGalleryPhotos() {
    if (!isSelectionMode.value) return;
    const all = orderedItems.value.map((item) => item.FilePath).filter(Boolean);
    gallerySelection.value = new Set(all);
  }

  function syncGallerySelectionWithLoadedItems() {
    const available = new Set(orderedItems.value.map((item) => item.FilePath));
    const next = new Set([...gallerySelection.value].filter((filePath) => available.has(filePath)));
    if (next.size !== gallerySelection.value.size) gallerySelection.value = next;
  }

  function addBatchTag() {
    const first = getBatchTagOptions?.()[0];
    if (first) addBatchTagOption?.(first.Text);
  }

  function setBatchStatus(tone, message) {
    batchStatus.visible = true;
    batchStatus.tone = tone;
    batchStatus.message = message;
  }

  function clearBatchEditInputs({ keepStatus = false } = {}) {
    Object.assign(batchEdit, { title: "", rating: null, privacy: null, album: "", tags: [], people: [], locationPlace: "" });
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
    const byPath = new Map(updatedItems.map((item) => [item.FilePath, item]));
    orderedItems.value = orderedItems.value.map((item) => byPath.get(item.FilePath) || item);
    for (const group of galleryGroups.value) {
      group.items = group.items.map((item) => byPath.get(item.FilePath) || item);
    }
    rebuildGalleryItemIndex();
    triggerRef(galleryGroups);
  }

  function removeBatchTagAt(index) {
    if (index >= 0 && index < batchEdit.tags.length) batchEdit.tags.splice(index, 1);
  }

  function removeBatchPersonAt(index) {
    if (index >= 0 && index < batchEdit.people.length) batchEdit.people.splice(index, 1);
  }

  function onBatchTagInputKeydown(event) {
    handleBatchTagKeydown?.(event);
  }

  async function applyBatchEdit() {
    const filePaths = [...gallerySelection.value];
    if (!filePaths.length) {
      showToastMessage("请先选择媒体");
      return;
    }

    const locationPatch = {};
    if (batchEdit.locationPlace.trim()) locationPatch.Place = batchEdit.locationPlace.trim();
    const customizationPatch = {};
    if (batchEdit.title.trim()) customizationPatch.Title = batchEdit.title.trim();
    if (batchEdit.rating !== null) customizationPatch.Rating = batchEdit.rating;
    if (batchEdit.privacy !== null) customizationPatch.Privacy = batchEdit.privacy;
    if (batchEdit.album.trim()) customizationPatch.Album = batchEdit.album.trim();
    const addTags = [...new Set(batchEdit.tags.map((value) => value.trim()).filter(Boolean))];
    const addPeople = [...new Set(batchEdit.people.map((value) => value.trim()).filter(Boolean))];
    if (!addTags.length && !addPeople.length && !Object.keys(locationPatch).length && !Object.keys(customizationPatch).length) {
      showToastMessage("请先填写要批量修改的内容");
      return;
    }

    const result = await api.batchUpdateMetadata({ filePaths, addTags, addPeople, locationPatch, customizationPatch });
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
    const requestedCount = Number(result.requestedCount || filePaths.length || 0);
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
