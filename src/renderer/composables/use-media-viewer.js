import { computed, reactive, ref } from "vue";
import { resolveHorizontalArrowAction } from "../video-playback.mjs";
import { allowsViewerGlobalShortcut, allowsViewerHorizontalArrow, VIEWER_ARROW_OVERLAYS } from "../domain/viewer-keyboard.mjs";
import { useViewerPanelLayout } from "./use-viewer-panel-layout.js";

/** Owns one viewer navigation session, shell panels, context actions, and global shortcuts. */
export function useMediaViewer({
  api,
  config,
  view,
  selectedItem,
  orderedItems,
  gallerySettingsOpen,
  editingDirty,
  saving,
  showToastMessage,
  setDraftFromItem,
  confirmEdit,
  cancelEdit,
  closeRegistryDropdowns,
  resetMediaTransform,
  releaseCurrentMedia,
  resetVideoPlaybackState,
  mediaStageRef,
  consumeCompletedDrag,
  isSelectedVideo,
  hasVideoPlaybackStarted,
  seekVideo,
  toggleVideoPlayback,
  stepVideoFrame,
  onReturnToGallery,
}) {
  const selectedGlobalIndex = ref(-1);
  const showContextMenu = ref(false);
  const contextPosition = reactive({ x: 0, y: 0 });
  const pendingViewerTransition = reactive({ visible: false, type: "", direction: 0 });
  let videoClickTimer = null;
  const panelLayout = useViewerPanelLayout({ config, onResizeStart: closeTransientPanels });

  const viewerHeaderTime = computed(() => {
    const raw = selectedItem.value?.FileSystem?.ShootingTimeString || "";
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/);
    if (!match) return "-";
    const [, year, rawMonth, rawDay, rawHour, rawMinute, rawSecond] = match;
    const month = String(Number(rawMonth)).padStart(2, "0");
    const day = String(Number(rawDay)).padStart(2, "0");
    const hour = String(Number(rawHour)).padStart(2, "0");
    const minute = String(Number(rawMinute)).padStart(2, "0");
    const second = String(Number(rawSecond)).padStart(2, "0");
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  });

  function openViewer(item) {
    clearVideoClickTimer();
    releaseCurrentMedia();
    panelLayout.resetViewerPanelLayout();
    selectedItem.value = item;
    selectedGlobalIndex.value = orderedItems.value.findIndex((candidate) => candidate.MediaId === item.MediaId);
    setDraftFromItem(item);
    resetMediaTransform();
    resetVideoPlaybackState(item);
    view.value = "viewer";
  }

  function performCloseViewer() {
    clearVideoClickTimer();
    releaseCurrentMedia();
    onReturnToGallery?.(selectedItem.value?.MediaId);
    view.value = "gallery";
    showContextMenu.value = false;
    panelLayout.resetViewerPanelLayout();
  }

  function performSwitchPhoto(direction) {
    const next = selectedGlobalIndex.value + direction;
    if (next < 0) {
      showToastMessage("This is the first media item");
      return;
    }
    if (next >= orderedItems.value.length) {
      showToastMessage("This is the last media item");
      return;
    }
    clearVideoClickTimer();
    releaseCurrentMedia(true);
    selectedGlobalIndex.value = next;
    selectedItem.value = orderedItems.value[next];
    setDraftFromItem(selectedItem.value);
    resetMediaTransform();
    resetVideoPlaybackState(selectedItem.value);
  }

  function completeViewerDeletion(nextItem) {
    clearVideoClickTimer();
    showContextMenu.value = false;
    if (!nextItem) {
      selectedItem.value = null;
      selectedGlobalIndex.value = -1;
      view.value = "gallery";
      panelLayout.resetViewerPanelLayout();
      return;
    }
    selectedItem.value = nextItem;
    selectedGlobalIndex.value = orderedItems.value.findIndex((item) => item.MediaId === nextItem.MediaId);
    setDraftFromItem(nextItem);
    resetMediaTransform();
    resetVideoPlaybackState(nextItem);
  }

  function requestViewerTransition(type, direction = 0) {
    if (!editingDirty.value) {
      if (type === "close") performCloseViewer();
      if (type === "switch") performSwitchPhoto(direction);
      return;
    }
    closeTransientPanels();
    Object.assign(pendingViewerTransition, { visible: true, type, direction });
  }

  function closeViewer() {
    requestViewerTransition("close");
  }

  function switchPhoto(direction) {
    const next = selectedGlobalIndex.value + direction;
    if (next < 0) {
      showToastMessage("This is the first media item");
      return;
    }
    if (next >= orderedItems.value.length) {
      showToastMessage("This is the last media item");
      return;
    }
    requestViewerTransition("switch", direction);
  }

  function cancelViewerTransition() {
    if (saving.value) return;
    Object.assign(pendingViewerTransition, { visible: false, type: "", direction: 0 });
  }

  function completePendingViewerTransition() {
    const { type, direction } = pendingViewerTransition;
    cancelViewerTransition();
    if (type === "close") performCloseViewer();
    if (type === "switch") performSwitchPhoto(direction);
  }

  async function saveAndContinueViewerTransition() {
    if (saving.value) return;
    if (await confirmEdit()) completePendingViewerTransition();
  }

  function discardAndContinueViewerTransition() {
    if (saving.value) return;
    cancelEdit();
    completePendingViewerTransition();
  }

  function openContextMenu(event) {
    event.preventDefault();
    contextPosition.x = event.clientX;
    contextPosition.y = event.clientY;
    showContextMenu.value = true;
  }

  function closeTransientPanels() {
    showContextMenu.value = false;
    gallerySettingsOpen.value = false;
    closeRegistryDropdowns?.();
  }

  async function contextCopyFile() {
    if (!selectedItem.value) return;
    const result = await api.copyFile(selectedItem.value.MediaId);
    if (result?.ok) showToastMessage("File copied to the clipboard");
    else showToastMessage(`Could not copy file: ${result?.error || "Unknown error"}`);
    closeTransientPanels();
  }

  async function contextCopyPath() {
    if (!selectedItem.value) return;
    const result = await api.copyPath(selectedItem.value.MediaId);
    if (result?.ok) showToastMessage("File path copied to the clipboard");
    else showToastMessage(`Could not copy file path: ${result?.error || "Unknown error"}`);
    closeTransientPanels();
  }

  async function contextCopyJson() {
    if (!selectedItem.value) return;
    try {
      const result = await api.copyJson(selectedItem.value.MediaId);
      if (result?.ok) showToastMessage("Media metadata copied to the clipboard");
      else showToastMessage(`Could not copy metadata: ${result?.error || "Unknown error"}`);
    } catch (error) {
      showToastMessage(`Could not copy metadata: ${error?.message || "Unknown error"}`);
    } finally {
      closeTransientPanels();
    }
  }

  async function toggleFullscreen() {
    const root = mediaStageRef.value;
    if (!root) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await root.requestFullscreen();
  }

  function clearVideoClickTimer() {
    if (videoClickTimer === null) return;
    window.clearTimeout(videoClickTimer);
    videoClickTimer = null;
  }

  function onVideoSurfaceClick(event) {
    if (event?.button !== 0 || consumeCompletedDrag?.()) return;
    clearVideoClickTimer();
    videoClickTimer = window.setTimeout(() => {
      videoClickTimer = null;
      toggleVideoPlayback();
    }, 220);
  }

  function onVideoSurfaceDoubleClick() {
    clearVideoClickTimer();
    toggleFullscreen();
  }

  function onGlobalKeydown(event) {
    if (view.value !== "viewer") return;
    const active = document.activeElement;
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    if (pendingViewerTransition.visible) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelViewerTransition();
      }
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const overlayOpen = [...document.querySelectorAll(VIEWER_ARROW_OVERLAYS)]
        .some(element => element.getClientRects().length > 0);
      if (!allowsViewerHorizontalArrow(event, active, overlayOpen)) return;
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const action = resolveHorizontalArrowAction({
        isVideo: isSelectedVideo.value,
        hasPlaybackStarted: hasVideoPlaybackStarted.value,
        shiftKey: event.shiftKey,
      });
      if (action === "seek") seekVideo(direction * 5);
      else switchPhoto(direction);
      return;
    }
    const allowsGlobalShortcut = allowsViewerGlobalShortcut(active);
    if (event.key === "Enter" && editingDirty.value && !saving.value
      && !event.isComposing && !event.repeat && allowsGlobalShortcut) {
      event.preventDefault();
      confirmEdit();
      return;
    }
    if (!allowsGlobalShortcut) return;
    if (isSelectedVideo.value) {
      if (event.key === " ") {
        event.preventDefault();
        toggleVideoPlayback();
        return;
      }
      if (event.key === ".") {
        event.preventDefault();
        stepVideoFrame(1);
        return;
      }
      if (event.key === ",") {
        event.preventDefault();
        stepVideoFrame(-1);
        return;
      }
    }
    if (event.key === "Escape") closeTransientPanels();
  }

  function initialize() {
    window.addEventListener("keydown", onGlobalKeydown);
    document.addEventListener("click", closeTransientPanels);
  }

  function dispose() {
    clearVideoClickTimer();
    panelLayout.disposeViewerPanelLayout();
    window.removeEventListener("keydown", onGlobalKeydown);
    document.removeEventListener("click", closeTransientPanels);
  }

  function resetViewerState() {
    clearVideoClickTimer();
    releaseCurrentMedia();
    selectedItem.value = null;
    selectedGlobalIndex.value = -1;
    showContextMenu.value = false;
    cancelViewerTransition();
    panelLayout.resetViewerPanelLayout();
  }

  return {
    selectedGlobalIndex,
    showContextMenu,
    contextPosition,
    pendingViewerTransition,
    ...panelLayout,
    viewerHeaderTime,
    openViewer,
    completeViewerDeletion,
    closeViewer,
    switchPhoto,
    cancelViewerTransition,
    saveAndContinueViewerTransition,
    discardAndContinueViewerTransition,
    openContextMenu,
    closeTransientPanels,
    contextCopyFile,
    contextCopyPath,
    contextCopyJson,
    toggleFullscreen,
    onVideoSurfaceClick,
    onVideoSurfaceDoubleClick,
    resetViewerState,
    initialize,
    dispose,
  };
}
