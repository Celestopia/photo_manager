<template>
<header class="topbar">
  <div class="left-tools"><button class="btn" @click="resetAll">还原</button></div>
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
      <div class="toolbar-group"><label>相册</label><select class="input" v-model="query.filters.album" @change="applyFilterSort"><option value="">全部</option><option v-for="album in filterOptions.albums" :key="album" :value="album">{{ album }}</option></select></div>
      <div class="toolbar-group"><label>标签</label><select class="input" v-model="query.filters.tag" @change="applyFilterSort"><option value="">全部</option><option v-for="tag in filterOptions.tags" :key="tag" :value="tag">{{ tag }}</option></select></div>
      <div class="toolbar-group" v-if="!isSelectionMode"><button class="btn" @click="enterSelectionMode">选择模式</button></div>
      <div class="toolbar-group" v-else><button class="btn" @click="selectAllGalleryPhotos">全选</button><button class="btn" @click="clearGallerySelection">全不选</button><button class="btn" @click="exitSelectionMode">退出选择</button><span class="batch-count">已选 {{ selectedGalleryCount }}</span></div>
      <div class="toolbar-group right"><label>排序</label><select class="input" v-model="query.sortBy" @change="applyFilterSort"><option value="shootingTime">拍摄时间</option><option value="filename">文件名</option><option value="rating">评级</option></select><select class="input" v-model="query.sortOrder" @change="applyFilterSort"><option value="desc">逆序</option><option value="asc">顺序</option></select></div>
    </section>
    <section class="gallery-list">
      <div class="summary">共 {{ total }} 张图片</div>
      <template v-for="group in galleryGroups" :key="group.date">
        <h2 class="date-title">{{ group.date }}</h2>
        <div class="photo-grid">
          <article class="photo-card" :class="{ selected: isSelectionMode && isGallerySelected(item.FilePath) }" v-for="item in group.items" :key="item.FilePath" @click="onGalleryCardClick(item)">
            <button v-if="isSelectionMode" type="button" class="card-select-toggle" :class="{ active: isGallerySelected(item.FilePath) }" @click.stop="toggleGallerySelection(item.FilePath)">✓</button>
            <img
              :src="resolveGalleryImageSrc(item)"
              :alt="item.Customization?.Title || item.FilePath"
              loading="lazy"
              @error="onGalleryImageError(item, $event)"
            />
            <div class="card-caption"><div class="title" :title="item.Customization?.Title || item.FilePath.split('/').pop()">{{ item.Customization?.Title || item.FilePath.split('/').pop() }}</div><div class="meta"><span>评级 {{ item.Customization?.Rating || '-' }}</span><span>{{ item.Picture?.Width || 0 }}x{{ item.Picture?.Height || 0 }}</span></div></div>
          </article>
        </div>
      </template>
    </section>
    <footer class="gallery-footer"><button class="btn" :disabled="!hasMore || loading" @click="loadMore">{{ loading ? '加载中...' : hasMore ? '加载更多' : '已加载全部' }}</button></footer>
  </section>
  <aside class="side-panel batch-panel" v-if="isSelectionMode && selectedGalleryCount > 0">
    <div class="batch-panel-header"><h3>批量编辑元信息</h3><button class="btn" @click="exitSelectionMode">关闭</button></div>
    <div class="batch-panel-summary">已选中 {{ selectedGalleryCount }} 张图片</div>
    <label>批量标题</label><input class="input" v-model="batchEdit.title" placeholder="输入后覆盖所选图片标题" />
    <label>添加标签</label>
    <div class="tag-editor" @click="$event.currentTarget.querySelector('input')?.focus()">
      <span class="tag-chip" v-for="(tag, index) in batchEdit.tags" :key="'batch_tag_' + tag + '_' + index">
        <span>{{ tag }}</span>
        <button type="button" class="tag-remove" @click.stop="removeBatchTagAt(index)">×</button>
      </span>
      <input
        class="tag-input"
        v-model="batchEdit.pendingTagInput"
        @keydown="onBatchTagInputKeydown"
        @blur="addBatchTag"
        placeholder="输入标签后按回车"
      />
    </div>
    <label>国家</label><input class="input" v-model="batchEdit.locationCountry" placeholder="如：中国" />
    <label>省/州</label><input class="input" v-model="batchEdit.locationProvince" placeholder="如：北京 / California" />
    <label>城市</label><input class="input" v-model="batchEdit.locationCity" placeholder="如：北京 / San Francisco" />
    <label>具体地点</label><input class="input" v-model="batchEdit.locationSite" placeholder="如：清华大学第六教学楼" />
    <div class="batch-actions">
      <button class="btn" @click="clearBatchEditInputs" :disabled="!batchHasChanges">清空输入</button>
      <button class="btn btn-primary batch-apply-btn" @click="applyBatchEdit" :disabled="!canApplyBatchEdit">应用到所选图片</button>
    </div>
    <div class="batch-status" v-if="batchStatus.visible" :class="batchStatus.tone">{{ batchStatus.message }}</div>
  </aside>
</main>
</template>

<script setup>
import { inject, ref } from "vue";

const app = inject("appContext");
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
  hasMore,
  loading,
  batchHasChanges,
  canApplyBatchEdit,
  windowToggleTip,
  windowToggleIcon,
  resetAll,
  applySearch,
  applyFilterSort,
  enterSelectionMode,
  exitSelectionMode,
  onGalleryCardClick,
  isGallerySelected,
  toggleGallerySelection,
  clearGallerySelection,
  selectAllGalleryPhotos,
  addBatchTag,
  removeBatchTagAt,
  onBatchTagInputKeydown,
  clearBatchEditInputs,
  applyBatchEdit,
  loadMore,
  buildImageUrl,
  doWindowAction,
  toggleWindowMaximizeRestore,
} = app;

// Track thumbnail load failures by hash to avoid repeated failing requests.
const brokenThumbnailHashes = ref(new Set());

/**
 * Resolve gallery card image source.
 * Priority:
 * 1) cached thumbnail file
 * 2) original image file fallback
 */
function resolveGalleryImageSrc(item) {
  const hash = item?.SHA256Hash || "";
  const thumbnailPath = item?.__thumbnailPath || "";
  if (hash && brokenThumbnailHashes.value.has(hash)) {
    return buildImageUrl(item.__absolutePath);
  }
  if (thumbnailPath) {
    return buildImageUrl(thumbnailPath);
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
  const originalSrc = buildImageUrl(item.__absolutePath);
  if (event?.target?.src !== originalSrc) {
    event.target.src = originalSrc;
  }
}
</script>
