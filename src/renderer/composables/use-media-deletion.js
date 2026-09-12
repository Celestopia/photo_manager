import { computed, nextTick, reactive } from "vue";

/** Owns the shared permanent-deletion confirmation and post-delete navigation. */
export function useMediaDeletion(options) {
  const {
    api,
    view,
    selectedItem,
    orderedItems,
    gallerySelection,
    editingDirty,
    selectedGlobalIndex,
    releaseCurrentMedia,
    resetVideoPlaybackState,
    cancelEdit,
    queryGallery,
    loadAllRegistries,
    exitSelectionMode,
    completeViewerDeletion,
    showToastMessage,
  } = options;
  const deletionDialog = reactive({ visible: false, mode: "single", items: [], busy: false, error: "" });
  const deletionBytes = computed(() => deletionDialog.items.reduce((sum, item) => {
    const bytes = Number(item?.FileSystem?.FileSize);
    return sum + (Number.isFinite(bytes) && bytes > 0 ? bytes : 0);
  }, 0));

  function closeDeletionDialog() {
    if (deletionDialog.busy) return;
    Object.assign(deletionDialog, { visible: false, mode: "single", items: [], error: "" });
  }

  function requestViewerDeletion() {
    if (!selectedItem.value) return;
    Object.assign(deletionDialog, { visible: true, mode: "single", items: [selectedItem.value], error: "" });
  }

  function requestBatchDeletion() {
    const items = orderedItems.value.filter((item) => gallerySelection.value.has(item.MediaId));
    if (!items.length) {
      showToastMessage("Select at least one media item");
      return;
    }
    Object.assign(deletionDialog, { visible: true, mode: "batch", items, error: "" });
  }

  async function restoreReleasedViewer(item) {
    selectedItem.value = null;
    await nextTick();
    selectedItem.value = item;
    resetVideoPlaybackState(item);
  }

  async function confirmDeletion() {
    if (deletionDialog.busy || !deletionDialog.items.length) return;
    const mediaIds = deletionDialog.items.map((item) => item.MediaId);
    const deletingFromViewer = deletionDialog.mode === "single" && view.value === "viewer";
    const viewerItem = deletingFromViewer ? selectedItem.value : null;
    const oldIndex = deletingFromViewer ? selectedGlobalIndex.value : -1;
    const oldItems = deletingFromViewer ? [...orderedItems.value] : [];
    deletionDialog.busy = true;
    deletionDialog.error = "";
    if (deletingFromViewer) releaseCurrentMedia();
    let result;
    try {
      result = await api.deleteMedia({ mediaIds });
      if (!result?.ok) throw new Error(result?.error || "Unknown error");
    } catch (error) {
      deletionDialog.error = `Could not delete media: ${error?.message || "Unknown error"}`;
      if (deletingFromViewer && viewerItem) await restoreReleasedViewer(viewerItem);
      deletionDialog.busy = false;
      return;
    }

    if (deletingFromViewer) cancelEdit();
    const galleryRefreshed = await queryGallery();
    await loadAllRegistries().catch((error) => showToastMessage(`Media was deleted, but registry counts could not be refreshed: ${error?.message || "Unknown error"}`));
    if (deletingFromViewer) {
      const deletedIds = new Set(mediaIds);
      const preferredIds = oldItems.slice(oldIndex + 1).concat(oldItems.slice(0, oldIndex).reverse())
        .map((item) => item.MediaId)
        .filter((mediaId) => !deletedIds.has(mediaId));
      const nextItem = galleryRefreshed
        ? preferredIds.map((mediaId) => orderedItems.value.find((item) => item.MediaId === mediaId)).find(Boolean) || null
        : null;
      completeViewerDeletion(nextItem);
    } else {
      exitSelectionMode();
    }
    const count = Number(result.deletedCount || mediaIds.length);
    showToastMessage(`${count} media item${count === 1 ? "" : "s"} permanently deleted${result.cleanupPending ? "; cleanup will resume when the library reopens" : ""}`);
    Object.assign(deletionDialog, { visible: false, mode: "single", items: [], error: "", busy: false });
  }

  function resetDeletionState() {
    Object.assign(deletionDialog, { visible: false, mode: "single", items: [], busy: false, error: "" });
  }

  return {
    deletionDialog,
    deletionBytes,
    editingDirty,
    requestViewerDeletion,
    requestBatchDeletion,
    closeDeletionDialog,
    confirmDeletion,
    resetDeletionState,
  };
}
