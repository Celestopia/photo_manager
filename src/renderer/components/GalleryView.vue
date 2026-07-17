<template>
<header class="topbar">
  <div class="left-tools"><button class="btn icon-btn" data-tip="还原画廊状态" aria-label="还原画廊状态" @click="resetAll"><img class="icon" :src="ICONS.restoreView" alt="" /></button></div>
  <div class="search-panel">
    <select v-model="query.search.field" class="input"><option value="title">标题</option><option value="filename">文件名</option><option value="description">描述</option></select>
    <input class="input grow" v-model="query.search.value" placeholder="输入搜索内容" @keydown.enter="applySearch" />
    <button class="btn btn-primary" @click="applySearch">搜索</button>
  </div>
  <div class="window-controls">
    <button class="btn ghost icon-btn" data-tip="最小化" @click="doWindowAction(WINDOW_ACTIONS.minimize)"><img class="icon" :src="ICONS.windowMinimize" alt="最小化" /></button>
    <button class="btn ghost icon-btn" :data-tip="windowToggleTip" @click="toggleWindowMaximizeRestore"><img class="icon" :src="windowToggleIcon" :alt="windowToggleTip" /></button>
    <button class="btn ghost danger icon-btn" data-tip="关闭" @click="doWindowAction(WINDOW_ACTIONS.close)"><img class="icon" :src="ICONS.windowClose" alt="关闭" /></button>
  </div>
</header>
<main class="gallery-main" :class="{ 'with-batch-panel': isSelectionMode && selectedGalleryCount > 0 }">
  <section class="gallery-content">
    <section class="toolbar-row">
      <div class="toolbar-group media-type-filter" role="group" aria-label="媒体类型">
        <button type="button" class="btn" :class="{ active: !query.filters.mediaType }" @click="setMediaTypeFilter('')">全部</button>
        <button type="button" class="btn" :class="{ active: query.filters.mediaType === 'image' }" @click="setMediaTypeFilter('image')">图片</button>
        <button type="button" class="btn" :class="{ active: query.filters.mediaType === 'video' }" @click="setMediaTypeFilter('video')">视频</button>
      </div>
      <div class="toolbar-group"><label>相册</label><RegistryFilterPicker kind="album" label="相册" /></div>
      <div class="toolbar-group"><label>标签</label><RegistryFilterPicker kind="tag" label="标签" /></div>
      <div class="toolbar-group"><label>人物</label><RegistryFilterPicker kind="person" label="人物" /></div>
      <div class="toolbar-group location-filter-group"><label>地点</label><LocationFilterPicker /></div>
      <div class="toolbar-group" v-if="!isSelectionMode"><button class="btn" @click="enterSelectionMode">选择模式</button></div>
      <div class="toolbar-group" v-else><button class="btn" @click="selectAllGalleryPhotos">全选</button><button class="btn" @click="clearGallerySelection">全不选</button><button class="btn" @click="exitSelectionMode">退出选择</button><span class="batch-count">已选 {{ selectedGalleryCount }}</span></div>
      <div class="toolbar-group right"><label>排序</label><select class="input" v-model="query.sortBy" @change="applyFilterSort"><option value="shootingTime">拍摄时间</option><option value="filename">文件名</option><option value="rating">评级</option></select><select class="input" v-model="query.sortOrder" @change="applyFilterSort"><option value="desc">逆序</option><option value="asc">顺序</option></select></div>
    </section>
    <section class="gallery-list">
      <div class="summary">{{ loading ? '正在加载媒体...' : `共 ${total} 个媒体` }}</div>
      <template v-for="group in galleryGroups" :key="group.date">
        <h2 class="date-title">{{ group.date }}</h2>
        <div class="photo-grid">
          <article
            class="photo-card"
            :class="{ selected: isSelectionMode && isGallerySelected(item.MediaId) }"
            v-for="item in group.items"
            :key="item.MediaId"
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
              <span v-if="isVideo(item)" class="video-play-badge" aria-label="视频">▶</span>
              <span v-if="videoFrameRateBadge(item)" class="video-frame-rate-badge">{{ videoFrameRateBadge(item) }}</span>
              <span v-if="isVideo(item) && item.Video?.DurationSeconds != null" class="video-duration-badge">{{ formatDuration(item.Video.DurationSeconds) }}</span>
              <span v-if="isVideo(item) && item.Video?.ProbeStatus === 'failed'" class="video-error-badge" :class="{ 'below-frame-rate': videoFrameRateBadge(item) }">解析失败</span>
              <span v-if="!isVideo(item) && item.Picture?.ProbeStatus === 'failed'" class="video-error-badge">解析失败</span>
            </div>
            <div class="card-caption">
              <div class="title" :title="item.Customization?.Title || item.FilePath.split('/').pop()">{{ item.Customization?.Title || item.FilePath.split('/').pop() }}</div>
              <div class="meta"><span>评级 {{ item.Customization?.Rating || '-' }}</span><span>{{ mediaDimensions(item) }}</span></div>
            </div>
          </article>
        </div>
      </template>
    </section>
  </section>
  <aside class="side-panel batch-panel" v-if="isSelectionMode && selectedGalleryCount > 0">
    <div class="batch-panel-header"><h3>批量编辑元信息</h3><button class="btn" @click="exitSelectionMode">关闭</button></div>
    <div class="batch-panel-summary">已选中 {{ selectedGalleryCount }} 个媒体</div>
    <label>批量设置标题</label><input class="input" v-model="batchEdit.title" placeholder="输入后覆盖所选媒体标题" />
    <label>批量设置评级</label>
    <div class="rating-stars" role="radiogroup" aria-label="批量设置评级">
      <button
        v-for="star in STAR_LEVELS"
        :key="'batch_rating_star_' + star"
        type="button"
        class="star-btn"
        :class="{ active: batchEdit.rating !== null && star <= batchEdit.rating }"
        :aria-checked="batchEdit.rating === star"
        :aria-label="'评级 ' + star + ' 星'"
        role="radio"
        @click="batchEdit.rating = star"
      >★</button>
    </div>
    <label>批量设置隐私等级</label>
    <PrivacyLevelPicker v-model="batchEdit.privacy" aria-label="批量设置隐私等级" />
    <label>批量设置相册</label>
    <AlbumPicker target="batch" placeholder="搜索已有相册" />
    <label>批量添加标签</label>
    <TagPicker target="batch" placeholder="搜索已有标签" />
    <label>批量添加人物</label>
    <PeoplePicker target="batch" placeholder="搜索已有人物" />
    <label>批量设置地点</label>
    <LocationPicker target="batch" placeholder="搜索已有地点" />
    <div class="batch-actions">
      <button class="btn" @click="clearBatchEditInputs" :disabled="!batchHasChanges">清空输入</button>
      <button class="btn btn-primary batch-apply-btn" @click="applyBatchEdit" :disabled="!canApplyBatchEdit">应用到所选媒体</button>
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
import { inject, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { GALLERY_CONTEXT } from "../context/renderer-contexts.js";
import AlbumPicker from "./AlbumPicker.vue";
import PeoplePicker from "./PeoplePicker.vue";
import LocationPicker from "./LocationPicker.vue";
import LocationFilterPicker from "./LocationFilterPicker.vue";
import RegistryFilterPicker from "./RegistryFilterPicker.vue";
import TagPicker from "./TagPicker.vue";
import GallerySettingsMenu from "./GallerySettingsMenu.vue";
import GalleryMediaDetailsMenu from "./GalleryMediaDetailsMenu.vue";
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
  filterOptions,
  isSelectionMode,
  selectedGalleryCount,
  batchEdit,
  batchStatus,
  total,
  galleryGroups,
  loading,
  batchHasChanges,
  canApplyBatchEdit,
  windowToggleTip,
  windowToggleIcon,
  UNASSIGNED_ALBUM_FILTER,
  getAlbumDescription,
  getTagDescription,
  getPersonDescription,
  resetAll,
  applySearch,
  applyFilterSort,
  setMediaTypeFilter,
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

// Track thumbnail load failures by hash to avoid repeated failing requests.
const brokenThumbnailHashes = ref(new Set());
const galleryDetailsMenu = reactive({ visible: false, item: null, x: 0, y: 0 });

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
  if (isEditableTarget || hasModalOverlay || !isSelectionMode.value || selectedGalleryCount.value <= 0) return;

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
});

onBeforeUnmount(() => {
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
 * 1) cached thumbnail file
 * 2) original image file fallback
 */
function resolveGalleryImageSrc(item) {
  const hash = item?.SHA256Hash || "";
  const thumbnailPath = item?.__thumbnailPath || "";
  if (!isVideo(item) && item?.Picture?.ProbeStatus === "failed") return ICONS.imagePlaceholder;
  if (isVideo(item) && (!thumbnailPath || (!item.__thumbnailAvailable && !item.__thumbnailReadyAt) || (hash && brokenThumbnailHashes.value.has(hash) && !item.__thumbnailReadyAt))) {
    return ICONS.videoPlaceholder;
  }
  if (hash && brokenThumbnailHashes.value.has(hash) && !item.__thumbnailReadyAt) {
    return buildImageUrl(item.__absolutePath);
  }
  if (thumbnailPath && (item.__thumbnailAvailable || item.__thumbnailReadyAt)) {
    const source = buildImageUrl(thumbnailPath);
    return item.__thumbnailReadyAt ? `${source}?v=${item.__thumbnailReadyAt}` : source;
  }
  return buildImageUrl(item.__absolutePath);
}

/**
 * Fallback to original image when thumbnail is missing or broken.
 */
function onGalleryImageError(item, event) {
  const hash = item?.SHA256Hash || "";
  if (hash) {
    const next = new Set(brokenThumbnailHashes.value);
    next.add(hash);
    brokenThumbnailHashes.value = next;
  }
  const originalSrc = isVideo(item) ? ICONS.videoPlaceholder : (item?.Picture?.ProbeStatus === "failed" ? ICONS.imagePlaceholder : buildImageUrl(item.__absolutePath));
  if (event?.target?.src !== originalSrc) {
    event.target.src = originalSrc;
  }
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
