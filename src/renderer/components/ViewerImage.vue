<template>
  <div class="viewer-image-surface" :class="{ 'image-pending': pending }" :aria-busy="pending">
    <img v-for="entry in entries" :key="entry.id" class="viewer-image" :src="entry.src" :alt="alt"
      draggable="false" :style="[entry.style, { visibility: entry === displayed ? 'visible' : 'hidden' }]"
      @load="loaded($event, entry)" @error="failed(entry)" />
    <canvas v-show="heldFrame" ref="frameCanvas" class="viewer-held-frame" />
    <span v-if="slow" class="viewer-image-status" role="status">Loading…</span>
    <span v-if="unavailable" class="viewer-image-status" role="status">{{ unavailableText }}</span>
  </div>
</template>

<script setup>
import { computed, ref, shallowRef, watch, onBeforeUnmount } from "vue";
const props = defineProps({ src: { type: String, default: "" }, alt: { type: String, default: "" }, mediaStyle: Object, unavailableText: { type: String, default: "Image unavailable" } });
const emit = defineEmits(["loaded", "pending"]);
const displayed = shallowRef(null), incoming = shallowRef(null);
const frameCanvas = ref(null), heldFrame = ref(false), slow = ref(false), unavailable = ref(false);
const entries = computed(() => [displayed.value, incoming.value].filter(Boolean));
const pending = computed(() => Boolean(incoming.value));
let serial = 0, timer;
function clearTimer() { clearTimeout(timer); slow.value = false; }
function clearFrame() { heldFrame.value = false; if (frameCanvas.value) frameCanvas.value.width = frameCanvas.value.height = 0; }
watch(() => props.src, src => {
  clearTimer(); unavailable.value = false;
  incoming.value = src ? { id: ++serial, src, style: { ...props.mediaStyle } } : null;
  emit("pending", Boolean(src));
  if (!src) { displayed.value = null; clearFrame(); }
  else timer = setTimeout(() => { slow.value = true; }, 200);
}, { immediate: true, flush: "sync" });
watch(() => props.mediaStyle, style => {
  if (incoming.value) incoming.value.style = { ...style };
  else if (displayed.value) displayed.value = { ...displayed.value, style: { ...style } };
}, { deep: true });
async function loaded(event, entry) {
  if (incoming.value !== entry) return;
  try { await event.currentTarget.decode(); } catch { return failed(entry); }
  if (incoming.value !== entry) return;
  displayed.value = entry; incoming.value = null;
  clearTimer(); clearFrame(); emit("pending", false); emit("loaded", entry.src);
}
function failed(entry) {
  if (incoming.value !== entry || entry.failed) return;
  entry.failed = true;
  incoming.value = null; displayed.value = null; clearFrame(); clearTimer();
  unavailable.value = true; emit("pending", false);
}
function retainVideo(element) {
  if (!element || element.readyState < 2 || !frameCanvas.value) return;
  const canvas = frameCanvas.value;
  const width = element.offsetWidth, height = element.offsetHeight;
  if (!width || !height) return;
  // A viewport-sized snapshot releases the old decoder immediately; never serialize pixel data.
  const scale = Math.min(1, 2560 / Math.max(width, height));
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  try {
    canvas.getContext("2d").drawImage(element, 0, 0, canvas.width, canvas.height);
    canvas.style.cssText = element.style.cssText;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    heldFrame.value = true;
  } catch { clearFrame(); }
}
onBeforeUnmount(() => { incoming.value = null; clearTimer(); clearFrame(); });
defineExpose({ retainVideo });
</script>
