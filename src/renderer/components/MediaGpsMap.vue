<template>
  <div v-show="active" ref="host" class="media-gps-map" @keydown.stop>
    <p v-if="!coordinates" class="gps-map-empty">GPS unavailable</p>
    <p v-else-if="!supported" class="gps-map-empty">Map unavailable at this latitude</p>
    <div v-else class="gps-map-inline">
      <GpsMapCanvas v-if="active && visible && !expanded" :coordinates="coordinates" :viewport="viewport" @viewport="viewport = $event" @expand="expand" />
    </div>
    <Teleport to="body">
      <dialog ref="dialog" class="gps-map-dialog" aria-label="Location map" @cancel.prevent @keydown.stop>
        <header><h3>Location</h3><button ref="closeButton" type="button" class="btn icon-btn" aria-label="Close map" title="Close map" @click="close"><img :src="closeIcon" alt="" /></button></header>
        <div class="gps-map-large">
          <GpsMapCanvas v-if="expanded && supported" :coordinates="coordinates" :viewport="viewport" expanded @viewport="viewport = $event" />
        </div>
      </dialog>
    </Teleport>
  </div>
</template>

<script setup>
import { defineAsyncComponent, computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { mapCoordinates, MAP_LATITUDE_LIMIT } from "../../shared/gps.mjs";
const GpsMapCanvas = defineAsyncComponent(() => import("./GpsMapCanvas.vue"));
const closeIcon = new URL("../assets/window_close.svg", import.meta.url).href;
const props = defineProps({ gps: Object, active: Boolean });
const coordinates = computed(() => mapCoordinates(props.gps));
const supported = computed(() => coordinates.value && Math.abs(coordinates.value.latitude) <= MAP_LATITUDE_LIMIT);
const host = ref(null), dialog = ref(null), closeButton = ref(null), visible = ref(false), expanded = ref(false), viewport = ref(null);
let observer, disposed = false;
async function expand() {
  expanded.value = true;
  await nextTick();
  if (disposed || !expanded.value) return;
  dialog.value.showModal(); closeButton.value.focus();
}
async function close() {
  dialog.value?.close(); expanded.value = false;
  await nextTick();
  if (!disposed && props.active) host.value?.querySelector('.gps-map-expand')?.focus();
}
watch(() => props.active, value => { if (!value) close(); });
watch(() => props.gps, () => { close(); viewport.value = null; });
onMounted(() => {
  observer = new IntersectionObserver(entries => { visible.value = entries[0]?.isIntersecting || false; });
  observer.observe(host.value);
});
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); dialog.value?.close(); });
</script>

<style>
.media-gps-map { margin: 10px 0 14px; }
.gps-map-inline { height: 200px; }
.gps-map-empty { color: var(--text-soft); font-size: 13px; margin: 8px 0; }
.gps-map-dialog { width: min(960px, calc(100vw - 48px)); max-width: none; max-height: calc(100vh - 48px); padding: 18px; box-sizing: border-box; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg-card); color: var(--text); box-shadow: var(--shadow); }
.gps-map-dialog::backdrop { background: rgba(23,55,86,.4); backdrop-filter: blur(var(--modal-backdrop-blur)); }
.gps-map-dialog header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.gps-map-dialog h3 { margin: 0; }
.gps-map-large { height: min(560px, calc(100vh - 150px)); }
.gps-map-dialog .gps-map-canvas { min-height: 0; }
</style>
