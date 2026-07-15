import { computed, reactive, ref } from "vue";
import { resolveHorizontalArrowAction } from "../video-playback.mjs";

/** Owns one viewer navigation session, shell panels, context actions, and global shortcuts. */
export function useMediaViewer({
  api,
  config,
  view,
  selectedItem,
  orderedItems,
  gallerySettingsOpen,
  editingDirty,
  showToastMessage,
  setDraftFromItem,
  confirmEdit,
  closeRegistryDropdowns,
  resetPanZoom,
  releaseCurrentMedia,
  resetVideoPlaybackState,
  imageStageRef,
  isSelectedVideo,
  hasVideoPlaybackStarted,
  seekVideo,
  toggleVideoPlayback,
  stepVideoFrame,
}) {
  const selectedGlobalIndex = ref(-1);
  const showContextMenu = ref(false);
  const contextPosition = reactive({ x: 0, y: 0 });
  const showPrivateNote = ref(false);
  const showLeftPanel = ref(true);
  const showRightPanel = ref(true);

  const ratioStyle = computed(() => {
    const ratio = config.value?.ui?.viewer?.panelRatio || { left: 1, center: 2, right: 1 };
    const left = showLeftPanel.value ? ratio.left : 0;
    const right = showRightPanel.value ? ratio.right : 0;
    return { gridTemplateColumns: `${left}fr ${ratio.center}fr ${right}fr` };
  });

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
    return `${year} 年 ${month} 月 ${day} 日 ${hour}:${minute}:${second}`;
  });

  function openViewer(item) {
    releaseCurrentMedia();
    selectedItem.value = item;
    selectedGlobalIndex.value = orderedItems.value.findIndex((candidate) => candidate.MediaId === item.MediaId);
    setDraftFromItem(item);
    resetPanZoom();
    resetVideoPlaybackState(item);
    view.value = "viewer";
  }

  function closeViewer() {
    releaseCurrentMedia();
    view.value = "gallery";
    showContextMenu.value = false;
  }

  function switchPhoto(direction) {
    const next = selectedGlobalIndex.value + direction;
    if (next < 0) {
      showToastMessage("已经是第一个媒体");
      return;
    }
    if (next >= orderedItems.value.length) {
      showToastMessage("已经是最后一个媒体");
      return;
    }
    releaseCurrentMedia();
    selectedGlobalIndex.value = next;
    selectedItem.value = orderedItems.value[next];
    setDraftFromItem(selectedItem.value);
    resetPanZoom();
    resetVideoPlaybackState(selectedItem.value);
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

  function toggleLeftPanel() { showLeftPanel.value = !showLeftPanel.value; }
  function toggleRightPanel() { showRightPanel.value = !showRightPanel.value; }

  async function contextCopyImage() {
    if (!selectedItem.value) return;
    const result = await api.copyImage(selectedItem.value.MediaId);
    if (result?.ok) showToastMessage("已成功复制到剪贴板");
    else showToastMessage(`复制失败：${result?.error || "未知错误"}`);
    closeTransientPanels();
  }

  async function contextCopyPath() {
    if (!selectedItem.value) return;
    const result = await api.copyPath(selectedItem.value.MediaId);
    if (result?.ok) showToastMessage("已成功复制文件路径");
    else showToastMessage(`复制失败：${result?.error || "未知错误"}`);
    closeTransientPanels();
  }

  async function contextCopyJson() {
    if (!selectedItem.value) return;
    try {
      const result = await api.copyJson(selectedItem.value.MediaId);
      if (result?.ok) showToastMessage("已成功复制媒体元信息");
      else showToastMessage(`复制失败：${result?.error || "未知错误"}`);
    } catch (error) {
      showToastMessage(`复制失败：${error?.message || "未知错误"}`);
    } finally {
      closeTransientPanels();
    }
  }

  async function toggleFullscreen() {
    const root = imageStageRef.value;
    if (!root) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await root.requestFullscreen();
  }

  function onGlobalKeydown(event) {
    if (view.value !== "viewer") return;
    const active = document.activeElement;
    const isTypingTarget = Boolean(
      active
      && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || active.isContentEditable),
    );
    const isTextarea = Boolean(active && active.tagName === "TEXTAREA");
    const isTagInput = Boolean(active?.classList?.contains("tag-input"));
    const isButtonControl = Boolean(active && (active.tagName === "BUTTON" || active.tagName === "SELECT"));
    if (event.key === "Enter" && editingDirty.value && !event.isComposing && !isTextarea && !isTagInput) {
      event.preventDefault();
      confirmEdit();
      return;
    }
    if (isTypingTarget) return;
    if (isButtonControl && (event.key === " " || event.key === "Enter")) return;
    if (isSelectedVideo.value) {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const action = resolveHorizontalArrowAction({
          isVideo: true,
          hasPlaybackStarted: hasVideoPlaybackStarted.value,
          shiftKey: event.shiftKey,
        });
        if (action === "seek") seekVideo(direction * 5);
        else switchPhoto(direction);
        return;
      }
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
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      switchPhoto(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      switchPhoto(1);
    }
    if (event.key === "Escape") closeTransientPanels();
  }

  function initialize() {
    window.addEventListener("keydown", onGlobalKeydown);
    document.addEventListener("click", closeTransientPanels);
  }

  function dispose() {
    window.removeEventListener("keydown", onGlobalKeydown);
    document.removeEventListener("click", closeTransientPanels);
  }

  function resetViewerState() {
    releaseCurrentMedia();
    selectedItem.value = null;
    selectedGlobalIndex.value = -1;
    showContextMenu.value = false;
  }

  return {
    selectedGlobalIndex,
    showContextMenu,
    contextPosition,
    showPrivateNote,
    showLeftPanel,
    showRightPanel,
    ratioStyle,
    viewerHeaderTime,
    openViewer,
    closeViewer,
    switchPhoto,
    openContextMenu,
    closeTransientPanels,
    toggleLeftPanel,
    toggleRightPanel,
    contextCopyImage,
    contextCopyPath,
    contextCopyJson,
    toggleFullscreen,
    resetViewerState,
    initialize,
    dispose,
  };
}
