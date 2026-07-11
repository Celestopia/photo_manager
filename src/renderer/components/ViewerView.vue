<template>
<header class="topbar">
  <div class="left-tools"><button class="btn icon-btn" data-tip="返回画廊" @click="closeViewer"><img class="icon" :src="ICONS.gallery" alt="返回画廊" /></button></div>
  <div class="viewer-title">{{ viewerHeaderTime }}</div>
  <div class="window-controls">
    <button class="btn ghost icon-btn" data-tip="最小化" @click="doWindowAction(WINDOW_ACTIONS.minimize)"><img class="icon" :src="ICONS.windowMinimize" alt="最小化" /></button>
    <button class="btn ghost icon-btn" :data-tip="windowToggleTip" @click="toggleWindowMaximizeRestore"><img class="icon" :src="windowToggleIcon" :alt="windowToggleTip" /></button>
    <button class="btn ghost danger icon-btn" data-tip="关闭" @click="doWindowAction(WINDOW_ACTIONS.close)"><img class="icon" :src="ICONS.windowClose" alt="关闭" /></button>
  </div>
</header>
<main class="viewer-main" :style="ratioStyle">
  <aside class="side-panel left-panel" :class="{ collapsed: !showLeftPanel }">
    <h3>图像信息</h3>
    <dl><dt>文件名</dt><dd>{{ selectedItem?.FilePath?.split('/').pop() }}</dd><dt>拍摄日期</dt><dd>{{ selectedItem?.FileSystem?.ShootingTimeString || '-' }}</dd><dt>修改日期</dt><dd>{{ selectedItem?.FileSystem?.ModificationTimeString || '-' }}</dd><dt>大小</dt><dd>{{ selectedItem?.Picture?.Width || 0 }}x{{ selectedItem?.Picture?.Height || 0 }} / {{ formatFileSize(selectedItem?.FileSystem?.FileSize) }}</dd></dl>
    <div class="camera-table-wrapper">
      <h4>相机参数</h4>
      <table class="camera-table">
        <tr><th>品牌</th><td>{{ selectedItem?.Camera?.Make || '-' }}</td></tr>
        <tr><th>型号</th><td>{{ selectedItem?.Camera?.Model || '-' }}</td></tr>
        <tr><th>焦距</th><td>{{ selectedItem?.Camera?.FocalLength || '-' }}</td></tr>
        <tr><th>光圈</th><td>{{ selectedItem?.Camera?.Aperture || '-' }}</td></tr>
        <tr><th>ISO</th><td>{{ selectedItem?.Camera?.ISO || '-' }}</td></tr>
        <tr><th>快门</th><td>{{ selectedItem?.Camera?.ExposureTime || '-' }}</td></tr>
        <tr><th>闪光灯</th><td>{{ selectedItem?.Camera?.FlashUsed ? '是' : '否' }}</td></tr>
      </table>
    </div>
  </aside>
  <section class="image-stage" ref="imageStageRef" @wheel="onImageWheel" @mousemove="onDrag" @mouseup="endDrag" @mouseleave="endDrag" @contextmenu="openContextMenu">
    <button class="nav-btn left" @click="switchPhoto(-1)">◀</button>
    <div class="image-container" @mousedown="startDrag" @dblclick.stop.prevent="toggleFullscreen"><img v-if="selectedItem" class="viewer-image" :src="buildImageUrl(selectedItem.__absolutePath)" :style="viewerImageStyle" /></div>
    <button class="nav-btn right" @click="switchPhoto(1)">▶</button>
    <div v-if="showContextMenu" class="context-menu" :style="{ left: contextPosition.x + 'px', top: contextPosition.y + 'px' }" @click.stop>
      <button @click="contextCopyImage">复制到剪贴板</button><button @click="contextCopyPath">复制图片路径</button><button @click="contextCopyJson">复制图片元信息JSON</button>
    </div>
  </section>
  <aside class="side-panel right-panel" :class="{ collapsed: !showRightPanel }">
    <h3>个性化信息</h3>
    <label>标题</label><textarea class="input field-textarea" v-model="editDraft.Title" @input="onFieldTextareaInput($event, 'Title')" rows="1"></textarea>
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'Title'"><span class="confirm-text">是否保存修改？ ——</span><button class="btn btn-primary" @click="confirmEdit">是</button><button class="btn" @click="cancelEdit">否</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'Title'">{{ saveNotice.message }}</div>
    <label>评级</label>
    <div class="rating-stars" role="radiogroup" aria-label="评级">
      <button
        v-for="star in STAR_LEVELS"
        :key="'rating_star_' + star"
        type="button"
        class="star-btn"
        :class="{ active: star <= editDraft.Rating }"
        :aria-label="'评级 ' + star + ' 星'"
        @click="setRating(star)"
      >★</button>
    </div>
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'Rating'"><span class="confirm-text">是否保存修改？ ——</span><button class="btn btn-primary" @click="confirmEdit">是</button><button class="btn" @click="cancelEdit">否</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'Rating'">{{ saveNotice.message }}</div>
    <label>相册</label>
    <AlbumPicker target="viewer" placeholder="搜索已有相册" />
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'Album'"><span class="confirm-text">是否保存修改？ ——</span><button class="btn btn-primary" @click="confirmEdit">是</button><button class="btn" @click="cancelEdit">否</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'Album'">{{ saveNotice.message }}</div>
    <div class="viewer-field-heading">
      <label>地点</label>
      <button
        type="button"
        class="viewer-detail-toggle"
        :aria-expanded="locationDetailExpanded"
        :aria-label="locationDetailExpanded ? '收起位置细节' : '展开位置细节'"
        :data-tip="locationDetailExpanded ? '收起位置细节' : '展开位置细节'"
        @click="locationDetailExpanded = !locationDetailExpanded"
      >
        <span class="viewer-detail-chevron" :class="{ expanded: locationDetailExpanded }">&gt;</span>
        <span v-if="editDraft.LocationDetail && !locationDetailExpanded" class="viewer-detail-indicator" aria-hidden="true"></span>
      </button>
    </div>
    <LocationPicker target="viewer" placeholder="添加已有地点" search-placeholder="搜索已有地点" />
    <textarea
      v-if="locationDetailExpanded"
      class="input field-textarea location-detail-input"
      v-model="editDraft.LocationDetail"
      @input="onFieldTextareaInput($event, 'Location')"
      rows="1"
      placeholder="输入具体位置细节"
    ></textarea>
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'Location'"><span class="confirm-text">是否保存修改？ ——</span><button class="btn btn-primary" @click="confirmEdit">是</button><button class="btn" @click="cancelEdit">否</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'Location'">{{ saveNotice.message }}</div>
    <label>人物</label>
    <PeoplePicker target="viewer" placeholder="添加已有人物" search-placeholder="搜索已有人物" />
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'People'"><span class="confirm-text">是否保存修改？ ——</span><button class="btn btn-primary" @click="confirmEdit">是</button><button class="btn" @click="cancelEdit">否</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'People'">{{ saveNotice.message }}</div>
    <label>标签</label>
    <TagPicker target="viewer" placeholder="搜索已有标签" />
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'Tags'"><span class="confirm-text">是否保存修改？ ——</span><button class="btn btn-primary" @click="confirmEdit">是</button><button class="btn" @click="cancelEdit">否</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'Tags'">{{ saveNotice.message }}</div>
    <div class="viewer-field-heading">
      <label>描述</label>
      <button
        type="button"
        class="viewer-detail-toggle"
        :aria-expanded="hiddenDescriptionExpanded"
        :aria-label="hiddenDescriptionExpanded ? '收起隐藏描述' : '展开隐藏描述'"
        :data-tip="hiddenDescriptionExpanded ? '收起隐藏描述' : '展开隐藏描述'"
        @click="hiddenDescriptionExpanded = !hiddenDescriptionExpanded"
      >
        <span class="viewer-detail-chevron" :class="{ expanded: hiddenDescriptionExpanded }">&gt;</span>
        <span v-if="editDraft.HiddenDescription && !hiddenDescriptionExpanded" class="viewer-detail-indicator" aria-hidden="true"></span>
      </button>
    </div>
    <textarea class="input textarea" v-model="editDraft.Description" @input="requestEdit('Description')"></textarea>
    <textarea
      v-if="hiddenDescriptionExpanded"
      class="input textarea private-textarea hidden-description-input"
      v-model="editDraft.HiddenDescription"
      @input="requestEdit('HiddenDescription')"
      placeholder="输入隐藏描述"
    ></textarea>
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'Description'"><span class="confirm-text">是否保存修改？ ——</span><button class="btn btn-primary" @click="confirmEdit">是</button><button class="btn" @click="cancelEdit">否</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'Description'">{{ saveNotice.message }}</div>
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'HiddenDescription'"><span class="confirm-text">是否保存修改？ ——</span><button class="btn btn-primary" @click="confirmEdit">是</button><button class="btn" @click="cancelEdit">否</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'HiddenDescription'">{{ saveNotice.message }}</div>
  </aside>
</main>
<footer class="viewer-footer">
  <div class="meta-popup-wrapper"><button class="btn icon-btn" data-tip="显示/隐藏图片信息" @click="toggleLeftPanel"><img class="icon" :src="ICONS.metadataInfo" alt="显示/隐藏图片信息" /></button></div>
  <div class="viewer-tools">
    <button class="btn icon-btn" data-tip="放大" @click="zoomIn"><img class="icon" :src="ICONS.zoomIn" alt="放大" /></button>
    <button class="btn icon-btn" data-tip="缩小" @click="zoomOut"><img class="icon" :src="ICONS.zoomOut" alt="缩小" /></button>
    <button class="btn icon-btn" data-tip="顺时针旋转" @click="rotateClockwise"><img class="icon" :src="ICONS.rotateClockwise" alt="顺时针旋转" /></button>
    <button class="btn icon-btn" data-tip="逆时针旋转" @click="rotateCounterclockwise"><img class="icon" :src="ICONS.rotateCounterclockwise" alt="逆时针旋转" /></button>
    <button class="btn icon-btn" data-tip="镜像" @click="toggleMirror"><img class="icon" :src="ICONS.mirror" alt="镜像" /></button>
    <button class="btn icon-btn" data-tip="复原视图" @click="restoreImageState"><img class="icon" :src="ICONS.restoreView" alt="复原视图" /></button>
    <div class="zoom-controls"><input class="input zoom-input" type="number" :min="minZoom" :max="maxZoom" v-model.number="zoomPercent" /><input class="slider" type="range" :min="minZoom" :max="maxZoom" :step="zoomStep" v-model.number="zoomPercent" /><button class="btn icon-btn" data-tip="图像全屏" @click="toggleFullscreen"><img class="icon" :src="ICONS.fullscreen" alt="图像全屏" /></button></div>
  </div>
  <div class="right-tools">
    <button class="btn icon-btn" data-tip="显示/隐藏个性化信息" @click="toggleRightPanel"><img class="icon" :src="ICONS.customization" alt="显示/隐藏个性化信息" /></button>
  </div>
</footer>
</template>

<script setup>
import { inject, ref } from "vue";
import AlbumPicker from "./AlbumPicker.vue";
import PeoplePicker from "./PeoplePicker.vue";
import LocationPicker from "./LocationPicker.vue";
import TagPicker from "./TagPicker.vue";

const app = inject("appContext");
if (!app) {
  throw new Error("ViewerView must be used under App.vue provider");
}

const locationDetailExpanded = ref(false);
const hiddenDescriptionExpanded = ref(false);

const {
  ICONS,
  WINDOW_ACTIONS,
  selectedItem,
  viewerHeaderTime,
  windowToggleTip,
  windowToggleIcon,
  ratioStyle,
  showLeftPanel,
  showRightPanel,
  imageStageRef,
  showContextMenu,
  contextPosition,
  editDraft,
  editingDirty,
  activeEditField,
  saveNotice,
  STAR_LEVELS,
  viewerImageStyle,
  minZoom,
  maxZoom,
  zoomPercent,
  zoomStep,
  closeViewer,
  doWindowAction,
  toggleWindowMaximizeRestore,
  formatFileSize,
  onImageWheel,
  onDrag,
  endDrag,
  openContextMenu,
  switchPhoto,
  startDrag,
  toggleFullscreen,
  buildImageUrl,
  contextCopyImage,
  contextCopyPath,
  contextCopyJson,
  onFieldTextareaInput,
  confirmEdit,
  cancelEdit,
  setRating,
  requestEdit,
  toggleLeftPanel,
  zoomIn,
  zoomOut,
  rotateClockwise,
  rotateCounterclockwise,
  toggleMirror,
  restoreImageState,
  toggleRightPanel,
} = app;
</script>
