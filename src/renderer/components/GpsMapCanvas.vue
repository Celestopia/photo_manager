<template>
  <div class="gps-map-surface" @keydown.stop @wheel.capture.prevent>
    <div ref="container" class="gps-map-canvas" aria-label="Media GPS map"></div>
    <button type="button" class="btn icon-btn gps-map-recenter" aria-label="Recenter" data-tip="Recenter" @click="recenter"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg></button>
    <button v-if="!expanded" type="button" class="btn icon-btn gps-map-expand" aria-label="Expand map" data-tip="Expand map" @click="$emit('expand')"><img :src="expandIcon" alt="" /></button>
    <div v-if="status" class="gps-map-status" role="status">{{ status }}<button v-if="failed" type="button" class="btn" @click="retry">Retry</button></div>
    <a class="gps-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
const expandIcon = new URL("../assets/image_fullscreen.svg", import.meta.url).href;
const props = defineProps({ coordinates: { type: Object, required: true }, viewport: Object, expanded: Boolean });
const emit = defineEmits(["viewport", "expand"]);
const container = ref(null), status = ref("Loading map…"), failed = ref(false);
let map, tiles, observer, timer;
function clearTimer() { clearTimeout(timer); }
function fail() { clearTimer(); failed.value = true; status.value = "Map unavailable"; }
function loading() {
  clearTimer(); failed.value = false; status.value = "Loading map…";
  timer = setTimeout(fail, 15000);
}
function retry() { loading(); tiles.redraw(); }
function recenter() { map.setView([props.coordinates.latitude, props.coordinates.longitude], 15, { animate: false }); }
onMounted(() => {
  const center = props.viewport?.center || [props.coordinates.latitude, props.coordinates.longitude];
  map = L.map(container.value, { attributionControl: false, scrollWheelZoom: true, doubleClickZoom: false, minZoom: 1, maxZoom: 19 }).setView(center, props.viewport?.zoom ?? 15);
  for (const control of map.zoomControl.getContainer().querySelectorAll("a")) {
    control.dataset.tip = control.title;
    control.removeAttribute("title");
  }
  map.on("dblclick", event => {
    if (!props.expanded && !event.originalEvent.target.closest(".leaflet-control")) emit("expand");
  });
  map.on("moveend", () => emit("viewport", { center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom() }));
  L.circleMarker([props.coordinates.latitude, props.coordinates.longitude], { radius: 8, weight: 3, color: "#fff", fillColor: "#1f72cc", fillOpacity: 1, interactive: false }).addTo(map);
  tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, keepBuffer: 0, updateWhenIdle: true, detectRetina: false });
  tiles.on("loading", loading).on("tileerror", fail).on("load", () => { clearTimer(); if (!failed.value) status.value = ""; });
  tiles.addTo(map);
  observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
  observer.observe(container.value);
});
onBeforeUnmount(() => { clearTimer(); observer?.disconnect(); map?.remove(); });
</script>

<style>
.gps-map-surface { position: relative; height: 100%; min-height: 200px; overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: var(--bg-card-soft); }
.gps-map-canvas { height: 100%; min-height: 200px; width: 100%; }
.gps-map-surface .leaflet-container { background: var(--bg-card-soft); font-family: inherit; }
.gps-map-surface .leaflet-control-zoom a { color: var(--text); width: 24px; height: 24px; line-height: 24px; font-size: 18px; }
.gps-map-surface .leaflet-top .leaflet-control { margin-top: 8px; }
.gps-map-surface .leaflet-left .leaflet-control { margin-left: 8px; }
.gps-map-surface .icon-btn { width: 26px; height: 26px; min-width: 26px; padding: 4px; border-radius: 7px; }
.gps-map-surface .icon-btn img, .gps-map-surface .icon-btn svg { width: 16px; height: 16px; }
.gps-map-recenter, .gps-map-expand, .gps-map-attribution, .gps-map-status { position: absolute; z-index: 1000; }
.gps-map-recenter { bottom: 8px; left: 8px; }
.gps-map-expand { right: 8px; top: 8px; }
.gps-map-attribution { right: 0; bottom: 0; background: rgba(255,255,255,.95); color: #173756; font-size: 11px; padding: 2px 5px; }
.gps-map-status { bottom: 64px; left: 10px; right: 10px; padding: 8px; background: var(--bg-card); border-radius: 8px; color: var(--text-soft); font-size: 13px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
</style>
