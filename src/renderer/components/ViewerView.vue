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
    <h3>{{ isSelectedVideo ? '视频信息' : '图像信息' }}</h3>
    <dl>
      <dt>文件名</dt><dd>{{ selectedItem?.FilePath?.split('/').pop() }}</dd>
      <dt>拍摄日期</dt><dd>{{ selectedItem?.FileSystem?.ShootingTimeString || '-' }}</dd>
      <dt>修改日期</dt><dd>{{ selectedItem?.FileSystem?.ModificationTimeString || '-' }}</dd>
      <dt>文件大小</dt><dd>{{ formatFileSize(selectedItem?.FileSystem?.FileSize) }}</dd>
      <dt>分辨率</dt><dd v-if="isSelectedVideo">{{ selectedItem?.Video?.DisplayWidth && selectedItem?.Video?.DisplayHeight ? selectedItem.Video.DisplayWidth + 'x' + selectedItem.Video.DisplayHeight : '-' }}</dd><dd v-else>{{ selectedItem?.Picture?.Width && selectedItem?.Picture?.Height ? selectedItem.Picture.Width + 'x' + selectedItem.Picture.Height : '-' }}</dd>
      <template v-if="isSelectedVideo">
        <dt>时长</dt><dd>{{ formatDuration(selectedItem?.Video?.DurationSeconds) }}</dd>
        <dt>帧率</dt><dd>{{ selectedItem?.Video?.FrameRate != null ? selectedItem.Video.FrameRate + ' fps' : '-' }}</dd>
      </template>
    </dl>
    <div v-if="!isSelectedVideo && selectedItem?.Picture?.ProbeStatus === 'failed'" class="video-probe-error">{{ selectedItem?.Picture?.ProbeError || '图片解析失败' }}</div>
    <div class="camera-table-wrapper" v-if="isSelectedVideo">
      <h4>视频参数</h4>
      <table class="camera-table">
        <tr><th>视频编码</th><td>{{ selectedItem?.Video?.VideoCodec || '-' }}<template v-if="selectedItem?.Video?.VideoProfile"> / {{ selectedItem.Video.VideoProfile }}</template></td></tr>
        <tr><th>视频码率</th><td>{{ formatBitRate(selectedItem?.Video?.BitRate) }}</td></tr>
        <tr><th>像素格式</th><td>{{ selectedItem?.Video?.PixelFormat || '-' }}<template v-if="selectedItem?.Video?.BitDepth"> / {{ selectedItem.Video.BitDepth }} bit</template></td></tr>
        <tr><th>音频</th><td>{{ selectedItem?.Video?.HasAudio ? (selectedItem.Video.AudioCodec || '有音轨') : '无音轨' }}<template v-if="selectedItem?.Video?.AudioBitRate"> / {{ formatBitRate(selectedItem.Video.AudioBitRate) }}</template></td></tr>
        <tr v-if="selectedItem?.Video?.HasAudio"><th>声道/采样</th><td>{{ selectedItem.Video.AudioChannels || '-' }} 声道 / {{ selectedItem.Video.AudioSampleRate || '-' }} Hz</td></tr>
        <tr><th>容器</th><td>{{ selectedItem?.Video?.ContainerFormat || '-' }}</td></tr>
        <tr><th>媒体流</th><td>视频 {{ selectedItem?.Video?.VideoStreamCount || 0 }} / 音频 {{ selectedItem?.Video?.AudioStreamCount || 0 }}</td></tr>
        <tr><th>旋转</th><td>{{ selectedItem?.Video?.RotationDegrees != null ? selectedItem.Video.RotationDegrees + '°' : '-' }}</td></tr>
      </table>
      <div v-if="selectedItem?.Video?.ProbeStatus === 'failed'" class="video-probe-error">{{ selectedItem?.Video?.ProbeError || '视频解析失败' }}</div>
    </div>
    <div v-if="!isSelectedVideo" class="camera-table-wrapper">
      <h4>相机参数</h4>
      <table class="camera-table">
        <tr><th>品牌</th><td>{{ selectedItem?.Camera?.Make || '-' }}</td></tr>
        <tr><th>型号</th><td>{{ selectedItem?.Camera?.Model || '-' }}</td></tr>
        <tr><th>焦距</th><td>{{ formatCameraValue(selectedItem?.Camera?.FocalLength) }}</td></tr>
        <tr><th>光圈</th><td>{{ formatCameraValue(selectedItem?.Camera?.Aperture) }}</td></tr>
        <tr><th>ISO</th><td>{{ formatCameraValue(selectedItem?.Camera?.ISO) }}</td></tr>
        <tr><th>快门</th><td>{{ formatCameraValue(selectedItem?.Camera?.ExposureTime) }}</td></tr>
        <tr><th>闪光灯</th><td>{{ formatFlashUsed(selectedItem?.Camera?.FlashUsed) }}</td></tr>
      </table>
    </div>
  </aside>
  <section class="image-stage" ref="mediaStageRef" @wheel="(!isSelectedVideo || videoPlaybackMode === 'video') && onMediaWheel($event)" @mouseup="endDrag" @mouseleave="endDrag" @contextmenu="openContextMenu">
    <button class="nav-btn left" @click="switchPhoto(-1)">◀</button>
    <div v-if="!isSelectedVideo" class="image-container" @mousedown="startDrag" @dblclick.stop.prevent="toggleFullscreen"><img v-if="selectedItem" class="viewer-image" :src="buildImageUrl(selectedItem.__absolutePath)" :style="viewerMediaStyle" /></div>
    <div v-else class="video-container">
      <template v-if="videoPlaybackMode === 'video'">
        <div
          class="video-transform-viewport"
          @mousedown="startDrag"
          @click="onVideoSurfaceClick"
          @dblclick.stop.prevent="onVideoSurfaceDoubleClick"
        >
          <video
            :key="selectedItem?.MediaId"
            ref="videoElementRef"
            class="viewer-video"
            preload="metadata"
            playsinline
            :style="viewerMediaStyle"
            :data-media-id="selectedItem?.MediaId"
            :poster="selectedItem?.__thumbnailAvailable ? buildImageUrl(selectedItem.__thumbnailPath) : ICONS.videoPlaceholder"
            :src="buildImageUrl(selectedItem?.__absolutePath)"
            @loadedmetadata="onVideoLoadedMetadata"
            @canplay="onVideoCanPlay"
            @waiting="onVideoWaiting"
            @progress="onVideoProgress"
            @durationchange="onVideoDurationChange"
            @error="onVideoPlaybackError"
            @volumechange="onVideoVolumeChange"
            @ratechange="onVideoRateChange"
            @playing="onMediaPlaying"
            @pause="onMediaPaused"
            @ended="onMediaEnded"
            @timeupdate="onMediaTimeUpdate"
            @seeked="onVideoSeeked"
          ></video>
        </div>
        <button
          v-if="showVideoCenterPlay"
          type="button"
          class="video-center-play-button"
          data-tip="播放"
          aria-label="播放"
          :disabled="!videoReady"
          @click="toggleVideoPlayback"
        >
          <img :src="ICONS.videoPlay" alt="" />
        </button>
        <VideoPlaybackControls
          :icons="ICONS"
          :playing="videoPlaying"
          :ready="videoReady"
          :waiting="videoWaiting"
          :current-time="videoDisplayedTime"
          :duration="videoDuration"
          :buffered-percent="videoBufferedPercent"
          :volume="videoVolume"
          :muted="videoMuted"
          @toggle-play="toggleVideoPlayback"
          @seek-start="beginVideoSeek"
          @seek-input="previewVideoSeek"
          @seek-commit="commitVideoSeek"
          @toggle-muted="toggleVideoMuted"
          @volume-input="setVideoVolume"
        />
      </template>
      <div v-else-if="videoPlaybackMode === 'audio'" class="video-fallback-panel">
        <img :src="selectedItem?.__thumbnailAvailable ? buildImageUrl(selectedItem.__thumbnailPath) : ICONS.videoPlaceholder" alt="视频封面" />
        <p>{{ videoPlaybackMessage || '当前仅播放音频' }}</p>
        <audio
          :key="selectedItem?.MediaId + '_audio'"
          ref="audioElementRef"
          controls
          preload="metadata"
          :data-media-id="selectedItem?.MediaId"
          :src="buildImageUrl(selectedItem?.__absolutePath)"
          @loadedmetadata="onAudioLoadedMetadata"
          @error="onAudioPlaybackError"
          @volumechange="onVideoVolumeChange"
          @ratechange="onVideoRateChange"
          @playing="onMediaPlaying"
          @pause="onMediaPaused"
          @ended="onMediaEnded"
          @timeupdate="onMediaTimeUpdate"
          @seeked="onMediaTimeUpdate"
        ></audio>
      </div>
      <div v-else class="video-fallback-panel video-unsupported-panel">
        <img :src="selectedItem?.__thumbnailAvailable ? buildImageUrl(selectedItem.__thumbnailPath) : ICONS.videoPlaceholder" alt="视频封面" />
        <p>{{ videoPlaybackMessage || selectedItem?.Video?.ProbeError || '当前播放器无法播放此媒体' }}</p>
        <div class="video-fallback-actions"><button class="btn btn-primary" @click.stop="openCurrentWithSystem">使用系统播放器打开</button><button class="btn" @click.stop="showCurrentInFolder">在资源管理器中显示</button></div>
      </div>
    </div>
    <button class="nav-btn right" @click="switchPhoto(1)">▶</button>
    <div v-if="showContextMenu" class="context-menu" :style="{ left: contextPosition.x + 'px', top: contextPosition.y + 'px' }" @click.stop>
      <button v-if="!isSelectedVideo" @click="contextCopyImage">复制到剪贴板</button><button @click="contextCopyPath">复制文件路径</button><button @click="contextCopyJson">复制媒体元信息 JSON</button><button @click="openCurrentWithSystem">使用系统默认程序打开</button><button @click="showCurrentInFolder">在资源管理器中显示</button>
    </div>
  </section>
  <aside class="side-panel right-panel" :class="{ collapsed: !showRightPanel }">
    <h3>个性化信息</h3>
    <label>标题</label><textarea class="input field-textarea viewer-title-input" v-model="editDraft.Title" @input="onFieldTextareaInput($event, 'Title')" rows="1"></textarea>
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'Title'"><span class="confirm-text">是否保存修改？ ——</span><button class="btn btn-primary" @click="confirmEdit">是</button><button class="btn" @click="cancelEdit">否</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'Title'">{{ saveNotice.message }}</div>
    <div class="viewer-field-heading">
      <label>评级</label>
      <button
        type="button"
        class="viewer-detail-toggle"
        :aria-expanded="privacyExpanded"
        :aria-label="privacyExpanded ? '收起隐私等级' : '展开隐私等级'"
        :data-tip="privacyExpanded ? '收起隐私等级' : '展开隐私等级'"
        @click="privacyExpanded = !privacyExpanded"
      >
        <span class="viewer-detail-chevron" :class="{ expanded: privacyExpanded }">&gt;</span>
      </button>
    </div>
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
    <template v-if="privacyExpanded">
      <label>隐私等级</label>
      <PrivacyLevelPicker :model-value="editDraft.Privacy" @update:model-value="setPrivacy" />
    </template>
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'Privacy'"><span class="confirm-text">是否保存修改？ ——</span><button class="btn btn-primary" @click="confirmEdit">是</button><button class="btn" @click="cancelEdit">否</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'Privacy'">{{ saveNotice.message }}</div>
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
  <div class="meta-popup-wrapper"><button class="btn icon-btn" data-tip="显示/隐藏媒体信息" @click="toggleLeftPanel"><img class="icon" :src="ICONS.metadataInfo" alt="显示/隐藏媒体信息" /></button></div>
  <div class="viewer-tools" :class="{ 'video-tools': isSelectedVideo }">
    <template v-if="canTransformSelectedMedia">
      <button class="btn icon-btn" data-tip="放大" @click="zoomIn"><img class="icon" :src="ICONS.zoomIn" alt="放大" /></button>
      <button class="btn icon-btn" data-tip="缩小" @click="zoomOut"><img class="icon" :src="ICONS.zoomOut" alt="缩小" /></button>
      <button class="btn icon-btn" data-tip="顺时针旋转" @click="rotateClockwise"><img class="icon" :src="ICONS.rotateClockwise" alt="顺时针旋转" /></button>
      <button class="btn icon-btn" data-tip="逆时针旋转" @click="rotateCounterclockwise"><img class="icon" :src="ICONS.rotateCounterclockwise" alt="逆时针旋转" /></button>
      <button class="btn icon-btn" data-tip="镜像" @click="toggleMirror"><img class="icon" :src="ICONS.mirror" alt="镜像" /></button>
      <button class="btn icon-btn" data-tip="复原视图" @click="restoreMediaState"><img class="icon" :src="ICONS.restoreView" alt="复原视图" /></button>
      <div class="zoom-controls"><input class="input zoom-input" type="number" :min="minZoom" :max="maxZoom" v-model.number="zoomPercent" /><input class="slider" type="range" :min="minZoom" :max="maxZoom" :step="zoomStep" v-model.number="zoomPercent" /></div>
    </template>
    <template v-if="isSelectedVideo">
      <button class="btn icon-btn" data-tip="上一帧" aria-label="上一帧" :disabled="!canStepVideoBackward" @click="stepVideoFrame(-1)"><img class="icon" :src="ICONS.previousFrame" alt="" /></button>
      <button class="btn icon-btn" data-tip="下一帧" aria-label="下一帧" :disabled="!canStepVideoForward" @click="stepVideoFrame(1)"><img class="icon" :src="ICONS.nextFrame" alt="" /></button>
    </template>
    <button class="btn icon-btn" :data-tip="isSelectedVideo ? '媒体全屏' : '图像全屏'" @click="toggleFullscreen"><img class="icon" :src="ICONS.fullscreen" :alt="isSelectedVideo ? '媒体全屏' : '图像全屏'" /></button>
    <button v-if="isSelectedVideo" class="btn icon-btn" data-tip="用系统播放器打开" aria-label="用系统播放器打开" @click="openCurrentWithSystem"><img class="icon" :src="ICONS.openSystem" alt="" /></button>
  </div>
  <div class="right-tools">
    <button class="btn icon-btn" data-tip="显示/隐藏个性化信息" @click="toggleRightPanel"><img class="icon" :src="ICONS.customization" alt="显示/隐藏个性化信息" /></button>
  </div>
</footer>
</template>

<script setup>
import { computed, inject, ref } from "vue";
import { VIEWER_CONTEXT } from "../context/renderer-contexts.js";
import AlbumPicker from "./AlbumPicker.vue";
import PeoplePicker from "./PeoplePicker.vue";
import LocationPicker from "./LocationPicker.vue";
import TagPicker from "./TagPicker.vue";
import PrivacyLevelPicker from "./PrivacyLevelPicker.vue";
import VideoPlaybackControls from "./VideoPlaybackControls.vue";

const app = inject(VIEWER_CONTEXT);
if (!app) {
  throw new Error("ViewerView must be used under App.vue provider");
}

const locationDetailExpanded = ref(false);
const hiddenDescriptionExpanded = ref(false);
const privacyExpanded = ref(false);

function formatCameraValue(value) {
  if (value == null || value === "") return "-";
  if (typeof value !== "number") return value;
  if (!Number.isFinite(value)) return "-";
  return Number(value.toFixed(6)).toString();
}

function formatFlashUsed(value) {
  if (value === true) return "是";
  if (value === false) return "否";
  return "-";
}

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
  mediaStageRef,
  videoElementRef,
  audioElementRef,
  videoPlaybackMode,
  videoPlaybackMessage,
  videoFrameStepping,
  videoDisplayedTime,
  videoDuration,
  videoPlaying,
  videoWaiting,
  videoReady,
  videoSeeking,
  videoBufferedPercent,
  videoVolume,
  videoMuted,
  canStepVideoBackward,
  canStepVideoForward,
  isSelectedVideo,
  showContextMenu,
  contextPosition,
  editDraft,
  editingDirty,
  activeEditField,
  saveNotice,
  STAR_LEVELS,
  viewerMediaStyle,
  minZoom,
  maxZoom,
  zoomPercent,
  zoomStep,
  closeViewer,
  doWindowAction,
  toggleWindowMaximizeRestore,
  formatFileSize,
  formatDuration,
  formatBitRate,
  onMediaWheel,
  endDrag,
  openContextMenu,
  switchPhoto,
  startDrag,
  toggleFullscreen,
  buildImageUrl,
  contextCopyImage,
  contextCopyPath,
  contextCopyJson,
  openCurrentWithSystem,
  showCurrentInFolder,
  onVideoLoadedMetadata,
  onVideoCanPlay,
  onVideoWaiting,
  onVideoProgress,
  onVideoDurationChange,
  onVideoPlaybackError,
  onAudioLoadedMetadata,
  onAudioPlaybackError,
  onVideoVolumeChange,
  onVideoRateChange,
  onMediaPlaying,
  onMediaPaused,
  onMediaEnded,
  onMediaTimeUpdate,
  onVideoSeeked,
  toggleVideoPlayback,
  beginVideoSeek,
  previewVideoSeek,
  commitVideoSeek,
  toggleVideoMuted,
  setVideoVolume,
  onVideoSurfaceClick,
  onVideoSurfaceDoubleClick,
  stepVideoFrame,
  onFieldTextareaInput,
  confirmEdit,
  cancelEdit,
  setRating,
  setPrivacy,
  requestEdit,
  toggleLeftPanel,
  zoomIn,
  zoomOut,
  rotateClockwise,
  rotateCounterclockwise,
  toggleMirror,
  restoreMediaState,
  toggleRightPanel,
} = app;

const canTransformSelectedMedia = computed(() => (
  !isSelectedVideo.value || videoPlaybackMode.value === "video"
));

const showVideoCenterPlay = computed(() => (
  videoPlaybackMode.value === "video"
  && !videoPlaying.value
  && !videoWaiting.value
  && !videoSeeking.value
  && !videoFrameStepping.value
));
</script>
