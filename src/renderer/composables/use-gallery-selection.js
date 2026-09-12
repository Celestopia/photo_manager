import { computed, reactive, ref, triggerRef } from "vue";

/** Owns gallery selection and batch operations built on the complete query result. */
export function useGallerySelection({
  api,
  orderedItems,
  galleryGroups,
  rebuildGalleryItemIndex,
  showToastMessage,
  openViewer,
  resetBatchPickers,
}) {
  const isSelectionMode = ref(false);
  const gallerySelection = ref(new Set());
  const batchEdit = reactive({ title: "", rating: null, privacy: null, albumId: null, tagIds: [], personIds: [], locationId: null });
  const batchStatus = reactive({ visible: false, tone: "info", message: "" });
  const applyingBatchEdit = ref(false);
  const copyingBatchFiles = ref(false);

  const selectedGalleryBytes = computed(() => orderedItems.value.reduce((sum, item) => {
    const bytes = item.FileSystem?.FileSize;
    return sum + (gallerySelection.value.has(item.MediaId) && Number.isFinite(bytes) && bytes > 0 ? bytes : 0);
  }, 0));
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
  const batchOperationBusy = computed(() => applyingBatchEdit.value || copyingBatchFiles.value);
  const canApplyBatchEdit = computed(() => !batchOperationBusy.value && selectedGalleryCount.value > 0 && batchHasChanges.value);

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

  async function applyBatchEdit() {
    if (batchOperationBusy.value) return;
    const mediaIds = [...gallerySelection.value];
    if (!mediaIds.length) {
      showToastMessage("Select at least one media item");
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
      showToastMessage("Choose at least one change to apply");
      return;
    }

    applyingBatchEdit.value = true;
    try {
      const result = await api.batchUpdateMetadata({ mediaIds, addTagIds, addPersonIds, locationPatch, customizationPatch });
      if (!result?.ok) {
        const message = `Could not apply batch changes: ${result?.error || "Unknown error"}`;
        showToastMessage(message);
        setBatchStatus("error", message);
        return;
      }

      const updatedItems = Array.isArray(result.items) ? result.items : [];
      syncUpdatedItemsIntoGallery(updatedItems);
      const updatedCount = Number(result.updatedCount || updatedItems.length || 0);
      const missingCount = Number(result.missingCount || 0);
      const requestedCount = Number(result.requestedCount || mediaIds.length || 0);
      const detail = missingCount > 0
        ? `Batch update complete: ${updatedCount} succeeded, ${missingCount} failed (${requestedCount} requested)`
        : `Batch update complete: ${updatedCount} media item(s) updated`;
      showToastMessage(detail);
      clearBatchEditInputs({ keepStatus: true });
      setBatchStatus(missingCount > 0 ? "warning" : "success", detail);
    } catch (error) {
      const message = `Could not apply batch changes: ${error?.message || "Unknown error"}`;
      showToastMessage(message);
      setBatchStatus("error", message);
    } finally {
      applyingBatchEdit.value = false;
    }
  }

  async function copySelectedFiles() {
    if (batchOperationBusy.value) return;
    const mediaIds = orderedItems.value
      .filter((item) => gallerySelection.value.has(item.MediaId))
      .map((item) => item.MediaId);
    if (!mediaIds.length) {
      showToastMessage("Select at least one media item");
      return;
    }
    copyingBatchFiles.value = true;
    try {
      const result = await api.copyFiles({ mediaIds });
      if (!result?.ok) throw new Error(result?.error || "Unknown error");
      const count = Number(result.copiedCount || mediaIds.length);
      showToastMessage(`${count} file${count === 1 ? "" : "s"} copied to the clipboard`);
    } catch (error) {
      showToastMessage(`Could not copy selected files: ${error?.message || "Unknown error"}`);
    } finally {
      copyingBatchFiles.value = false;
    }
  }

  return {
    isSelectionMode,
    gallerySelection,
    batchEdit,
    batchStatus,
    applyingBatchEdit,
    copyingBatchFiles,
    batchOperationBusy,
    selectedGalleryCount,
    selectedGalleryBytes,
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
    setBatchStatus,
    clearBatchEditInputs,
    resetSelectionState,
    syncUpdatedItemsIntoGallery,
    removeBatchTagAt,
    removeBatchPersonAt,
    applyBatchEdit,
    copySelectedFiles,
  };
}
