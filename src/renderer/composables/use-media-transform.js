import { computed, reactive, ref, watch } from "vue";
import {
  calculateFittedMediaSize,
  calculateRotationFitScale,
  exceedsDragThreshold,
} from "../domain/media-transform.mjs";

/** Owns temporary image and video zoom, pan, rotation, mirror, and drag state. */
export function useMediaTransform({ config, selectedItem }) {
  const zoomPercent = ref(100);
  const rotateDeg = ref(0);
  const mirror = ref(false);
  const pan = reactive({ x: 0, y: 0 });
  const dragging = reactive({
    pending: false, active: false, moved: false,
    startX: 0, startY: 0, baseX: 0, baseY: 0,
  });
  const mediaStageRef = ref(null);
  const stageSize = reactive({ width: 0, height: 0 });
  let resizeObserver = null;

  const minZoom = computed(() => config.value?.ui?.viewer?.zoom?.minPercent ?? 10);
  const maxZoom = computed(() => config.value?.ui?.viewer?.zoom?.maxPercent ?? 1000);
  const zoomStep = computed(() => config.value?.ui?.viewer?.zoom?.stepPercent ?? 10);
  const isVideo = computed(() => selectedItem.value?.FileSystem?.FileType === "video");
  const sourceSize = computed(() => ({
    width: Number(selectedItem.value?.Video?.DisplayWidth || selectedItem.value?.Video?.Width || 0),
    height: Number(selectedItem.value?.Video?.DisplayHeight || selectedItem.value?.Video?.Height || 0),
  }));
  const fittedSize = computed(() => isVideo.value
    ? calculateFittedMediaSize({
        stageWidth: stageSize.width,
        stageHeight: stageSize.height,
        mediaWidth: sourceSize.value.width,
        mediaHeight: sourceSize.value.height,
      })
    : { width: 0, height: 0 });
  const rotationFitScale = computed(() => isVideo.value
    ? calculateRotationFitScale({
        stageWidth: stageSize.width,
        stageHeight: stageSize.height,
        fittedWidth: fittedSize.value.width,
        fittedHeight: fittedSize.value.height,
        rotationDegrees: rotateDeg.value,
      })
    : 1);
  const viewerMediaStyle = computed(() => {
    const fitted = fittedSize.value;
    const userScale = zoomPercent.value / 100;
    const style = {
      transform:
        `translate(${pan.x}px, ${pan.y}px) `
        + `scale(${userScale * rotationFitScale.value}) `
        + `rotate(${rotateDeg.value}deg) `
        + `scaleX(${mirror.value ? -1 : 1})`,
      transition: dragging.active ? "none" : "transform 90ms linear",
    };
    // Images retain their intrinsic browser-oriented dimensions; video uses normalized display dimensions.
    if (isVideo.value && fitted.width > 0 && fitted.height > 0) {
      style.width = `${fitted.width}px`;
      style.height = `${fitted.height}px`;
      style.maxWidth = "none";
      style.maxHeight = "none";
    }
    return style;
  });

  function updateStageSize(element = mediaStageRef.value) {
    if (!element) {
      stageSize.width = 0;
      stageSize.height = 0;
      return;
    }
    const rect = element.getBoundingClientRect();
    stageSize.width = Math.max(0, rect.width);
    stageSize.height = Math.max(0, rect.height);
  }

  function observeStage(element) {
    resizeObserver?.disconnect();
    resizeObserver = null;
    updateStageSize(element);
    if (!element || typeof ResizeObserver !== "function") return;
    resizeObserver = new ResizeObserver(() => updateStageSize(element));
    resizeObserver.observe(element);
  }

  watch(mediaStageRef, (element) => observeStage(element), { flush: "post" });

  function resetMediaTransform() {
    zoomPercent.value = 100;
    rotateDeg.value = 0;
    mirror.value = false;
    pan.x = 0;
    pan.y = 0;
    Object.assign(dragging, { pending: false, active: false, moved: false });
  }

  function getWheelZoomStep() {
    if (zoomPercent.value > 500) return 50;
    if (zoomPercent.value >= 200) return 20;
    return zoomStep.value;
  }

  function onMediaWheel(event) {
    if (event.target?.closest?.(".video-playback-controls, input, button, audio")) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    const step = getWheelZoomStep();
    zoomPercent.value = Math.min(maxZoom.value, Math.max(minZoom.value, zoomPercent.value + direction * step));
  }

  function startDrag(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    Object.assign(dragging, {
      pending: true,
      active: false,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      baseX: pan.x,
      baseY: pan.y,
    });
  }

  function onDrag(event) {
    if (!dragging.pending) return;
    if ((event.buttons & 1) === 0) {
      endDrag();
      return;
    }
    const deltaX = event.clientX - dragging.startX;
    const deltaY = event.clientY - dragging.startY;
    if (!dragging.active && !exceedsDragThreshold(deltaX, deltaY)) return;
    dragging.active = true;
    dragging.moved = true;
    pan.x = dragging.baseX + deltaX;
    pan.y = dragging.baseY + deltaY;
  }

  function endDrag() {
    dragging.pending = false;
    dragging.active = false;
  }

  function consumeCompletedDrag() {
    const moved = dragging.moved;
    dragging.moved = false;
    return moved;
  }

  function restoreMediaState() { resetMediaTransform(); }
  function zoomIn() { zoomPercent.value = Math.min(maxZoom.value, zoomPercent.value + zoomStep.value); }
  function zoomOut() { zoomPercent.value = Math.max(minZoom.value, zoomPercent.value - zoomStep.value); }
  function rotateClockwise() { rotateDeg.value += 90; }
  function rotateCounterclockwise() { rotateDeg.value -= 90; }
  function toggleMirror() { mirror.value = !mirror.value; }

  function initialize() {
    window.addEventListener("mousemove", onDrag);
    window.addEventListener("mouseup", endDrag);
    observeStage(mediaStageRef.value);
  }

  function dispose() {
    window.removeEventListener("mousemove", onDrag);
    window.removeEventListener("mouseup", endDrag);
    resizeObserver?.disconnect();
    resizeObserver = null;
  }

  return {
    zoomPercent,
    rotateDeg,
    mirror,
    pan,
    dragging,
    mediaStageRef,
    minZoom,
    maxZoom,
    zoomStep,
    viewerMediaStyle,
    resetMediaTransform,
    onMediaWheel,
    startDrag,
    endDrag,
    consumeCompletedDrag,
    restoreMediaState,
    zoomIn,
    zoomOut,
    rotateClockwise,
    rotateCounterclockwise,
    toggleMirror,
    initialize,
    dispose,
  };
}
