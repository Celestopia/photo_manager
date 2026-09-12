<template>
  <div class="gallery-settings-anchor" @click.stop>
    <button class="btn icon-btn gallery-settings-trigger" data-tip="Library settings" aria-label="Library settings" :aria-expanded="gallerySettingsOpen" @click="onToggleGallerySettings">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
    </button>
    <div v-if="gallerySettingsOpen" class="gallery-settings-menu">
      <button @click="openLibraryInfo"><span>ⓘ</span>Library Information</button>
      <button @click="openMaintenanceDialog('update')"><span>↻</span>Update Metadata</button>
      <button @click="openMaintenanceDialog('verify')"><span>✓</span>Verify Metadata</button>
      <button @click="openMaintenanceDialog('thumbnails')"><span>▦</span>Generate Thumbnails</button>
      <button @click="openMaintenanceDialog('export')"><span>⇩</span>Export Metadata CSV</button>
      <div class="gallery-settings-separator"></div>
      <button @click="openAlbumManager"><span>▣</span>Manage Albums</button>
      <button @click="openLocationManager"><span>⌖</span>Manage Locations</button>
      <button @click="openPersonManager"><span>♙</span>Manage People</button>
      <button @click="openTagManager"><span>◇</span>Manage Tags</button>
      <div class="gallery-settings-separator"></div>
      <button @click="openProviderSettings"><span>⚙</span>LLM Provider Settings</button>
      <div class="gallery-settings-separator"></div>
      <button class="danger-text" @click="returnToLibraryEntry"><span>↩</span>Close Current Library</button>
    </div>
  </div>
</template>

<script setup>
import { inject, onBeforeUnmount, onMounted } from "vue";
import { SETTINGS_CONTEXT, CHAT_CONTEXT } from "../context/renderer-contexts.js";

const chat = inject(CHAT_CONTEXT);
function openProviderSettings() {
  closeGallerySettings();
  void chat.showSettings();
}

const GALLERY_SETTINGS_SURFACE = Symbol("gallery-settings");
const app = inject(SETTINGS_CONTEXT);
if (!app) throw new Error("GallerySettingsMenu must be used under App.vue provider");
const {
  ICONS,
  isSelectionMode,
  gallerySettingsOpen,
  toggleGallerySettings,
  closeGallerySettings,
  openLibraryInfo,
  openMaintenanceDialog,
  openAlbumManager,
  openLocationManager,
  openPersonManager,
  openTagManager,
  returnToLibraryEntry,
} = app;

function onToggleGallerySettings() {
  if (!gallerySettingsOpen.value) {
    window.dispatchEvent(new CustomEvent("gallery-transient-open", { detail: GALLERY_SETTINGS_SURFACE }));
  }
  toggleGallerySettings();
}

function closeFromOtherSurface(event) {
  if (event.detail !== GALLERY_SETTINGS_SURFACE) closeGallerySettings();
}

onMounted(() => window.addEventListener("gallery-transient-open", closeFromOtherSurface));
onBeforeUnmount(() => window.removeEventListener("gallery-transient-open", closeFromOtherSurface));
</script>
