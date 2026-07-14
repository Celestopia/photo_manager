import { computed, reactive, ref } from "vue";

/** Owns image-only zoom, pan, rotation, mirror, and drag interactions. */
export function useImageTransform({ config }) {
  const zoomPercent = ref(100);
  const rotateDeg = ref(0);
  const mirror = ref(false);
  const pan = reactive({ x: 0, y: 0 });
  const dragging = reactive({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });
  const imageStageRef = ref(null);

  const minZoom = computed(() => config.value?.ui?.viewer?.zoom?.minPercent ?? 10);
  const maxZoom = computed(() => config.value?.ui?.viewer?.zoom?.maxPercent ?? 1000);
  const zoomStep = computed(() => config.value?.ui?.viewer?.zoom?.stepPercent ?? 10);
  const viewerImageStyle = computed(() => ({
    transform:
      `translate(${pan.x}px, ${pan.y}px) `
      + `scale(${zoomPercent.value / 100}) `
      + `rotate(${rotateDeg.value}deg) `
      + `scaleX(${mirror.value ? -1 : 1})`,
    transition: dragging.active ? "none" : "transform 90ms linear",
  }));

  function resetPanZoom() {
    zoomPercent.value = 100;
    rotateDeg.value = 0;
    mirror.value = false;
    pan.x = 0;
    pan.y = 0;
  }

  function getWheelZoomStep() {
    if (zoomPercent.value > 500) return 50;
    if (zoomPercent.value >= 200) return 20;
    return zoomStep.value;
  }

  function onImageWheel(event) {
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    const step = getWheelZoomStep();
    zoomPercent.value = Math.min(maxZoom.value, Math.max(minZoom.value, zoomPercent.value + direction * step));
  }

  function startDrag(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging.active = true;
    dragging.startX = event.clientX;
    dragging.startY = event.clientY;
    dragging.baseX = pan.x;
    dragging.baseY = pan.y;
  }

  function onDrag(event) {
    if (!dragging.active) return;
    if ((event.buttons & 1) === 0) {
      endDrag();
      return;
    }
    pan.x = dragging.baseX + (event.clientX - dragging.startX);
    pan.y = dragging.baseY + (event.clientY - dragging.startY);
  }

  function endDrag() {
    dragging.active = false;
  }

  function restoreImageState() { resetPanZoom(); }
  function zoomIn() { zoomPercent.value = Math.min(maxZoom.value, zoomPercent.value + zoomStep.value); }
  function zoomOut() { zoomPercent.value = Math.max(minZoom.value, zoomPercent.value - zoomStep.value); }
  function rotateClockwise() { rotateDeg.value += 90; }
  function rotateCounterclockwise() { rotateDeg.value -= 90; }
  function toggleMirror() { mirror.value = !mirror.value; }

  function initialize() {
    window.addEventListener("mousemove", onDrag);
    window.addEventListener("mouseup", endDrag);
  }

  function dispose() {
    window.removeEventListener("mousemove", onDrag);
    window.removeEventListener("mouseup", endDrag);
  }

  return {
    zoomPercent,
    rotateDeg,
    mirror,
    pan,
    dragging,
    imageStageRef,
    minZoom,
    maxZoom,
    zoomStep,
    viewerImageStyle,
    resetPanZoom,
    onImageWheel,
    startDrag,
    onDrag,
    endDrag,
    restoreImageState,
    zoomIn,
    zoomOut,
    rotateClockwise,
    rotateCounterclockwise,
    toggleMirror,
    initialize,
    dispose,
  };
}
