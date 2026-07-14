<template>
  <div v-if="!isSelectionMode" class="gallery-settings-anchor" @click.stop>
    <button class="btn icon-btn gallery-settings-trigger" data-tip="图库设置" :aria-expanded="gallerySettingsOpen" @click="toggleGallerySettings">
      <img class="icon" :src="ICONS.settings" alt="图库设置" />
    </button>
    <div v-if="gallerySettingsOpen" class="gallery-settings-menu">
      <button @click="openLibraryInfo"><span>ⓘ</span>图库信息</button>
      <button @click="openMaintenanceDialog('update')"><span>↻</span>更新元数据</button>
      <button @click="openMaintenanceDialog('verify')"><span>✓</span>检查元数据</button>
      <button @click="openMaintenanceDialog('thumbnails')"><span>▦</span>生成缩略图</button>
      <button @click="openMaintenanceDialog('export')"><span>⇩</span>导出元数据 CSV</button>
      <div class="gallery-settings-separator"></div>
      <button @click="openAlbumManager"><span>▣</span>相册管理</button>
      <button @click="openLocationManager"><span>⌖</span>地点管理</button>
      <button @click="openPersonManager"><span>♙</span>人物管理</button>
      <button @click="openTagManager"><span>◇</span>标签管理</button>
      <div class="gallery-settings-separator"></div>
      <button class="danger-text" @click="returnToLibraryEntry"><span>↩</span>退出当前图库</button>
    </div>
  </div>
</template>

<script setup>
import { inject } from "vue";
import { SETTINGS_CONTEXT } from "../context/renderer-contexts.js";
const app = inject(SETTINGS_CONTEXT);
if (!app) throw new Error("GallerySettingsMenu must be used under App.vue provider");
const {
  ICONS,
  isSelectionMode,
  gallerySettingsOpen,
  toggleGallerySettings,
  openLibraryInfo,
  openMaintenanceDialog,
  openAlbumManager,
  openLocationManager,
  openPersonManager,
  openTagManager,
  returnToLibraryEntry,
} = app;
</script>
