<template>
<header class="topbar">
  <div class="left-tools"><button class="btn icon-btn" data-tip="Reset gallery" aria-label="Reset gallery" @click="resetAll"><img class="icon" :src="ICONS.restoreView" alt="" /></button></div>
  <div class="search-panel">
    <select v-model="query.search.field" class="input"><option value="title">Title</option><option value="filename">File name</option><option value="description">Description</option></select>
    <input class="input grow" v-model="query.search.value" placeholder="Enter search text" @keydown.enter="applySearch" />
    <button class="btn btn-primary" @click="applySearch">Search</button>
  </div>
  <div class="window-controls">
    <button class="btn ghost icon-btn" data-tip="Minimize" @click="doWindowAction(WINDOW_ACTIONS.minimize)"><img class="icon" :src="ICONS.windowMinimize" alt="Minimize" /></button>
    <button class="btn ghost icon-btn" :data-tip="windowToggleTip" @click="toggleWindowMaximizeRestore"><img class="icon" :src="windowToggleIcon" :alt="windowToggleTip" /></button>
    <button class="btn ghost danger icon-btn" data-tip="Close" @click="doWindowAction(WINDOW_ACTIONS.close)"><img class="icon" :src="ICONS.windowClose" alt="Close" /></button>
  </div>
</header>
<main class="gallery-main" :class="{ 'with-batch-panel': isSelectionMode }">
  <section class="gallery-content">
    <section class="gallery-controls-host">
      <div class="gallery-controls-drawer" :class="{ expanded: galleryControlsExpanded }">
        <Transition name="gallery-filters">
        <section v-if="galleryControlsExpanded" id="gallery-filter-panel" class="gallery-controls-panel">
          <div class="gallery-controls-primary">
            <div class="toolbar-group"><label>Album</label><RegistryFilterPicker kind="album" label="Album" /></div>
            <div class="toolbar-group"><label>Tags</label><RegistryFilterPicker kind="tag" label="Tags" /></div>
            <div class="toolbar-group"><label>People</label><RegistryFilterPicker kind="person" label="People" /></div>
            <div class="toolbar-group location-filter-group"><label>Location</label><LocationFilterPicker /></div>
            <div class="toolbar-group selection-tools" v-if="!isSelectionMode"><button class="btn" @click="enterSelectionMode">Select</button></div>
            <div class="toolbar-group selection-tools" v-else><button class="btn" @click="selectAllGalleryPhotos">Select all</button><button class="btn" @click="clearGallerySelection">Clear selection</button><button class="btn" @click="exitSelectionMode">Exit selection</button><span class="batch-count">{{ selectedGalleryCount }} selected</span></div>
            <div class="toolbar-group sort-tools"><label>Sort</label><select class="input" v-model="query.sortBy" @change="applyFilterSort"><option value="shootingTime">Date taken</option></select><select class="input" v-model="query.sortOrder" @change="applyFilterSort"><option value="desc">Descending</option><option value="asc">Ascending</option></select></div>
          </div>
          <div class="gallery-controls-secondary">
            <div class="gallery-media-type-filter">
              <span class="gallery-filter-label">Media type</span>
              <div class="segmented-filter" role="group" aria-label="Media type">
                <button type="button" :class="{ active: !query.filters.mediaType }" :aria-pressed="!query.filters.mediaType" @click="setMediaTypeFilter('')">All</button>
                <button type="button" :class="{ active: query.filters.mediaType === 'image' }" :aria-pressed="query.filters.mediaType === 'image'" @click="setMediaTypeFilter('image')">Images</button>
                <button type="button" :class="{ active: query.filters.mediaType === 'video' }" :aria-pressed="query.filters.mediaType === 'video'" @click="setMediaTypeFilter('video')">Videos</button>
              </div>
            </div>
            <GalleryLevelFilter
              label="Rating"
              :levels="STAR_LEVELS"
              :selected-levels="query.filters.ratingLevels"
              @select-all="setAllGalleryLevels('ratingLevels')"
              @toggle-level="toggleGalleryLevelFilter('ratingLevels', $event)"
            />
            <GalleryLevelFilter
              label="Privacy"
              :levels="STAR_LEVELS"
              :selected-levels="query.filters.privacyLevels"
              @select-all="setAllGalleryLevels('privacyLevels')"
              @toggle-level="toggleGalleryLevelFilter('privacyLevels', $event)"
            />
          </div>
        </section>
        </Transition>
        <button
          type="button"
          class="gallery-controls-toggle"
          :data-tip="galleryControlsExpanded ? 'Collapse filters and sorting' : 'Expand filters and sorting'"
          :aria-label="galleryControlsExpanded ? 'Collapse filters and sorting' : 'Expand filters and sorting'"
          :aria-expanded="galleryControlsExpanded"
          aria-controls="gallery-filter-panel"
          @click="onToggleControls"
        >
          <span v-if="galleryControlsModified" class="gallery-controls-status-dot" aria-hidden="true"></span>
          <img class="gallery-controls-chevron" :class="galleryControlsExpanded ? 'point-up' : 'point-down'" :src="ICONS.chevronDown" alt="" />
        </button>
      </div>
    </section>
    <section ref="galleryListRef" class="gallery-list">
      <div class="summary">{{ loading ? 'Loading media...' : `${total} media items` }}</div>
      <template v-for="group in galleryGroups" :key="group.date">
        <h2 class="date-title">{{ group.date }}</h2>
        <div class="photo-grid">
          <article
            class="photo-card"
            :class="{ selected: isSelectionMode && isGallerySelected(item.MediaId) }"
            v-for="item in group.items"
            :key="item.MediaId"
            :data-media-id="item.MediaId"
            @click="onGalleryCardClick(item)"
            @contextmenu.prevent.stop="toggleGalleryDetailsMenu(item, $event)"
          >
            <button v-if="isSelectionMode" type="button" class="card-select-toggle" :class="{ active: isGallerySelected(item.MediaId) }" @click.stop="toggleGallerySelection(item.MediaId)">✓</button>
            <div class="card-media">
              <img
                :src="resolveGalleryImageSrc(item)"
                :alt="item.Customization?.Title || item.FilePath"
                loading="lazy"
                @error="onGalleryImageError(item, $event)"
              />
              <span v-if="isVideo(item)" class="video-play-badge" aria-label="Video">▶</span>
              <span v-if="videoFrameRateBadge(item)" class="video-frame-rate-badge">{{ videoFrameRateBadge(item) }}</span>
              <span v-if="isVideo(item) && item.Video?.DurationSeconds != null" class="video-duration-badge">{{ formatDuration(item.Video.DurationSeconds) }}</span>
              <span v-if="isVideo(item) && item.Video?.ProbeStatus === 'failed'" class="video-error-badge" :class="{ 'below-frame-rate': videoFrameRateBadge(item) }">Probe failed</span>
              <span v-if="!isVideo(item) && item.Picture?.ProbeStatus === 'failed'" class="video-error-badge">Probe failed</span>
            </div>
            <div class="card-caption">
              <div class="title" :title="item.Customization?.Title || item.FilePath.split('/').pop()">{{ item.Customization?.Title || item.FilePath.split('/').pop() }}</div>
              <div class="meta">
                <span class="card-rating-stars" :aria-label="`${item.Customization?.Rating}-star rating`">
                  <span v-for="star in item.Customization?.Rating" :key="star" aria-hidden="true">★</span>
                </span>
                <span>{{ mediaDimensions(item) }}</span>
              </div>
            </div>
          </article>
        </div>
      </template>
    </section>
  </section>
  <aside class="side-panel batch-panel" v-if="isSelectionMode" :class="{ 'is-saving': applyingBatchEdit }" :inert="applyingBatchEdit ? '' : undefined" :aria-busy="applyingBatchEdit">
    <div class="batch-panel-header"><h3>Batch Edit Metadata</h3><button class="btn" @click="exitSelectionMode">Close</button></div>
    <div class="batch-panel-summary">{{ selectedGalleryCount }} media items selected</div>
    <label>Set title</label><input class="input" v-model="batchEdit.title" placeholder="Replace titles of selected media" />
    <label>Set rating</label>
    <div class="rating-stars" role="radiogroup" aria-label="Set rating for selected media">
      <button
        v-for="star in STAR_LEVELS"
        :key="'batch_rating_star_' + star"
        type="button"
        class="star-btn"
        :class="{ active: batchEdit.rating !== null && star <= batchEdit.rating }"
        :aria-checked="batchEdit.rating === star"
        :aria-label="star + '-star rating'"
        role="radio"
        @click="batchEdit.rating = star"
      >★</button>
    </div>
    <label>Set privacy level</label>
    <PrivacyLevelPicker v-model="batchEdit.privacy" aria-label="Set privacy level for selected media" />
    <label>Set album</label>
    <AlbumPicker target="batch" placeholder="Search albums" />
    <label>Add tags</label>
    <TagPicker target="batch" placeholder="Search tags" />
    <label>Add people</label>
    <PeoplePicker target="batch" placeholder="Search people" />
    <label>Set location</label>
    <LocationPicker target="batch" placeholder="Search locations" />
    <div class="batch-actions">
      <button class="btn" @click="clearBatchEditInputs" :disabled="!batchHasChanges">Clear fields</button>
      <button class="btn btn-primary batch-apply-btn" @click="applyBatchEdit" :disabled="!canApplyBatchEdit">{{ applyingBatchEdit ? 'Applying...' : 'Apply to selected media' }}</button>
    </div>
    <div class="batch-status" v-if="batchStatus.visible" :class="batchStatus.tone">{{ batchStatus.message }}</div>
  </aside>
</main>
<footer class="gallery-footer">
  <GallerySettingsMenu />
</footer>
<GalleryMediaDetailsMenu
  v-if="galleryDetailsMenu.visible && galleryDetailsMenu.item"
  :item="galleryDetailsMenu.item"
  :x="galleryDetailsMenu.x"
  :y="galleryDetailsMenu.y"
/>
</template>

<script setup>
function onToggleControls() {
  window.dispatchEvent(new CustomEvent("gallery-transient-open", { detail: "filter-panel-toggle" }));
  toggleGalleryControls();
}

import { inject, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { GALLERY_CONTEXT } from "../context/renderer-contexts.js";
import AlbumPicker from "./AlbumPicker.vue";
import PeoplePicker from "./PeoplePicker.vue";
import LocationPicker from "./LocationPicker.vue";
import LocationFilterPicker from "./LocationFilterPicker.vue";
import RegistryFilterPicker from "./RegistryFilterPicker.vue";
import TagPicker from "./TagPicker.vue";
import GallerySettingsMenu from "./GallerySettingsMenu.vue";
import GalleryMediaDetailsMenu from "./GalleryMediaDetailsMenu.vue";
import GalleryLevelFilter from "./GalleryLevelFilter.vue";
import PrivacyLevelPicker from "./PrivacyLevelPicker.vue";
import { STAR_LEVELS } from "../constants/ui-constants.mjs";

const GALLERY_DETAILS_SURFACE = Symbol("gallery-media-details");

const app = inject(GALLERY_CONTEXT);
if (!app) {
  throw new Error("GalleryView must be used under App.vue provider");
}

const {
  ICONS,
  WINDOW_ACTIONS,
  query,
  galleryControlsExpanded,
  galleryControlsModified,
  isSelectionMode,
  selectedGalleryCount,
  batchEdit,
  batchStatus,
  applyingBatchEdit,
  total,
  galleryGroups,
  loading,
  batchHasChanges,
  canApplyBatchEdit,
  windowToggleTip,
  windowToggleIcon,
  resetAll,
  applySearch,
  applyFilterSort,
  setMediaTypeFilter,
  setAllGalleryLevels,
  toggleGalleryLevelFilter,
  toggleGalleryControls,
  consumeGalleryReturnMediaId,
  enterSelectionMode,
  exitSelectionMode,
  onGalleryCardClick,
  isGallerySelected,
  toggleGallerySelection,
  clearGallerySelection,
  selectAllGalleryPhotos,
  clearBatchEditInputs,
  applyBatchEdit,
  buildImageUrl,
  doWindowAction,
  toggleWindowMaximizeRestore,
} = app;

const galleryDetailsMenu = reactive({ visible: false, item: null, x: 0, y: 0 });
const galleryListRef = ref(null);
let galleryRestoreFrame = null;

function restoreViewedMediaPosition() {
  const mediaId = consumeGalleryReturnMediaId?.();
  if (!mediaId || !galleryListRef.value) return;
  const card = galleryListRef.value.querySelector(`[data-media-id="${CSS.escape(mediaId)}"]`);
  card?.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
}

function closeGalleryDetailsMenu() {
  galleryDetailsMenu.visible = false;
  galleryDetailsMenu.item = null;
}

function toggleGalleryDetailsMenu(item, event) {
  const isSameItem = galleryDetailsMenu.visible && galleryDetailsMenu.item?.MediaId === item?.MediaId;
  window.dispatchEvent(new CustomEvent("gallery-transient-open", { detail: GALLERY_DETAILS_SURFACE }));
  if (isSameItem) {
    closeGalleryDetailsMenu();
    return;
  }
  galleryDetailsMenu.item = item;
  galleryDetailsMenu.x = event.clientX;
  galleryDetailsMenu.y = event.clientY;
  galleryDetailsMenu.visible = true;
}

function closeDetailsFromOtherSurface(event) {
  if (event.detail !== GALLERY_DETAILS_SURFACE) closeGalleryDetailsMenu();
}

function closeDetailsOnExternalPointer(event) {
  if (event.button !== 0 || event.target?.closest?.(".gallery-media-details-menu")) return;
  closeGalleryDetailsMenu();
}

function closeDetailsOnScroll(event) {
  if (event.target?.closest?.(".gallery-media-details-menu")) return;
  closeGalleryDetailsMenu();
}

function handleGalleryKeydown(event) {
  if (event.key !== "Escape" || event.repeat) return;
  if (galleryDetailsMenu.visible) {
    closeGalleryDetailsMenu();
    return;
  }

  const target = event.target;
  const isEditableTarget = ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName) || target?.isContentEditable;
  const hasModalOverlay = Boolean(document.querySelector(".tag-modal-backdrop"));
  if (isEditableTarget || hasModalOverlay || !isSelectionMode.value) return;

  event.preventDefault();
  exitSelectionMode();
}

onMounted(() => {
  document.addEventListener("pointerdown", closeDetailsOnExternalPointer, true);
  document.addEventListener("contextmenu", closeGalleryDetailsMenu);
  document.addEventListener("scroll", closeDetailsOnScroll, true);
  window.addEventListener("resize", closeGalleryDetailsMenu);
  window.addEventListener("keydown", handleGalleryKeydown);
  window.addEventListener("gallery-transient-open", closeDetailsFromOtherSurface);
  nextTick(() => {
    galleryRestoreFrame = window.requestAnimationFrame(() => {
      galleryRestoreFrame = null;
      restoreViewedMediaPosition();
    });
  });
});

onBeforeUnmount(() => {
  if (galleryRestoreFrame !== null) window.cancelAnimationFrame(galleryRestoreFrame);
  document.removeEventListener("pointerdown", closeDetailsOnExternalPointer, true);
  document.removeEventListener("contextmenu", closeGalleryDetailsMenu);
  document.removeEventListener("scroll", closeDetailsOnScroll, true);
  window.removeEventListener("resize", closeGalleryDetailsMenu);
  window.removeEventListener("keydown", handleGalleryKeydown);
  window.removeEventListener("gallery-transient-open", closeDetailsFromOtherSurface);
});

/**
 * Resolve gallery card image source.
 * Priority:
 * Missing thumbnails intentionally use placeholders until the user runs the
 * explicit thumbnail-generation maintenance task.
 */
function resolveGalleryImageSrc(item) {
  const thumbnailPath = item?.__thumbnailPath || "";
  if (thumbnailPath && item.__thumbnailAvailable) {
    const source = buildImageUrl(thumbnailPath);
    const thumbnailVersion = Number(item.__thumbnailVersion || 0);
    return thumbnailVersion > 0 ? `${source}?v=${thumbnailVersion}` : source;
  }
  return isVideo(item) ? ICONS.videoPlaceholder : ICONS.imagePlaceholder;
}

/**
 * A broken cache entry is treated the same as a missing thumbnail.
 */
function onGalleryImageError(item, event) {
  const placeholder = isVideo(item) ? ICONS.videoPlaceholder : ICONS.imagePlaceholder;
  if (event?.target?.src !== placeholder) event.target.src = placeholder;
}

function isVideo(item) {
  return item?.FileSystem?.FileType === "video";
}

function videoFrameRateBadge(item) {
  if (!isVideo(item)) return "";
  const frameRate = Number(item?.Video?.FrameRate);
  return Number.isFinite(frameRate) && frameRate > 0 ? `${Math.round(frameRate)}FPS` : "";
}

function formatDuration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || value === null || value === undefined) return "-";
  const total = Math.max(0, Math.floor(numeric));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function mediaDimensions(item) {
  const width = isVideo(item) ? item?.Video?.DisplayWidth : item?.Picture?.Width;
  const height = isVideo(item) ? item?.Video?.DisplayHeight : item?.Picture?.Height;
  return width && height ? `${width}x${height}` : "-";
}
</script>
