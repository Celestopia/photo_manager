<template>
<header class="topbar">
  <div class="left-tools"><button class="btn icon-btn" data-tip="Back to Gallery" @click="closeViewer"><img class="icon" :src="ICONS.gallery" alt="Back to Gallery" /></button></div>
  <div class="viewer-title">{{ viewerHeaderTime }}</div>
  <div class="window-controls">
    <button class="btn ghost icon-btn" data-tip="Minimize" @click="doWindowAction(WINDOW_ACTIONS.minimize)"><img class="icon" :src="ICONS.windowMinimize" alt="Minimize" /></button>
    <button class="btn ghost icon-btn" :data-tip="windowToggleTip" @click="toggleWindowMaximizeRestore"><img class="icon" :src="windowToggleIcon" :alt="windowToggleTip" /></button>
    <button class="btn ghost danger icon-btn" data-tip="Close" @click="doWindowAction(WINDOW_ACTIONS.close)"><img class="icon" :src="ICONS.windowClose" alt="Close" /></button>
  </div>
</header>
<main class="viewer-main" :style="ratioStyle">
  <aside class="side-panel left-panel" :class="{ collapsed: !showLeftPanel }">
    <h3>{{ isSelectedVideo ? 'Video Information' : 'Image Information' }}</h3>
    <dl>
      <dt>File name</dt><dd>{{ selectedItem?.FilePath?.split('/').pop() }}</dd>
      <dt>Date taken</dt><dd>{{ selectedItem?.FileSystem?.ShootingTimeString || '-' }}</dd>
      <dt>Date modified</dt><dd>{{ selectedItem?.FileSystem?.ModificationTimeString || '-' }}</dd>
      <dt>File size</dt><dd>{{ formatFileSize(selectedItem?.FileSystem?.FileSize) }}</dd>
      <dt>Resolution</dt><dd v-if="isSelectedVideo">{{ selectedItem?.Video?.DisplayWidth && selectedItem?.Video?.DisplayHeight ? selectedItem.Video.DisplayWidth + 'x' + selectedItem.Video.DisplayHeight : '-' }}</dd><dd v-else>{{ selectedItem?.Picture?.Width && selectedItem?.Picture?.Height ? selectedItem.Picture.Width + 'x' + selectedItem.Picture.Height : '-' }}</dd>
      <template v-if="isSelectedVideo">
        <dt>Duration</dt><dd>{{ formatDuration(selectedItem?.Video?.DurationSeconds) }}</dd>
        <dt>Frame rate</dt><dd>{{ selectedItem?.Video?.FrameRate != null ? selectedItem.Video.FrameRate + ' fps' : '-' }}</dd>
      </template>
    </dl>
    <div v-if="!isSelectedVideo && selectedItem?.Picture?.ProbeStatus === 'failed'" class="video-probe-error">{{ selectedItem?.Picture?.ProbeError || 'Could not analyze image' }}</div>
    <div class="camera-table-wrapper" v-if="isSelectedVideo">
      <h4>Video Parameters</h4>
      <table class="camera-table">
        <tr><th>Video codec</th><td>{{ selectedItem?.Video?.VideoCodec || '-' }}<template v-if="selectedItem?.Video?.VideoProfile"> / {{ selectedItem.Video.VideoProfile }}</template></td></tr>
        <tr><th>Video bit rate</th><td>{{ formatBitRate(selectedItem?.Video?.BitRate) }}</td></tr>
        <tr><th>Pixel format</th><td>{{ selectedItem?.Video?.PixelFormat || '-' }}<template v-if="selectedItem?.Video?.BitDepth"> / {{ selectedItem.Video.BitDepth }} bit</template></td></tr>
        <tr><th>Audio</th><td>{{ selectedItem?.Video?.HasAudio ? (selectedItem.Video.AudioCodec || 'Audio track') : 'No audio track' }}<template v-if="selectedItem?.Video?.AudioBitRate"> / {{ formatBitRate(selectedItem.Video.AudioBitRate) }}</template></td></tr>
        <tr v-if="selectedItem?.Video?.HasAudio"><th>Channels / sample rate</th><td>{{ selectedItem.Video.AudioChannels || '-' }} channels / {{ selectedItem.Video.AudioSampleRate || '-' }} Hz</td></tr>
        <tr><th>Container</th><td>{{ selectedItem?.Video?.ContainerFormat || '-' }}</td></tr>
        <tr><th>Streams</th><td>Video {{ selectedItem?.Video?.VideoStreamCount || 0 }} / Audio {{ selectedItem?.Video?.AudioStreamCount || 0 }}</td></tr>
        <tr><th>Rotation</th><td>{{ selectedItem?.Video?.RotationDegrees != null ? selectedItem.Video.RotationDegrees + '°' : '-' }}</td></tr>
      </table>
      <div v-if="selectedItem?.Video?.ProbeStatus === 'failed'" class="video-probe-error">{{ selectedItem?.Video?.ProbeError || 'Could not analyze video' }}</div>
    </div>
    <div v-if="!isSelectedVideo" class="camera-table-wrapper">
      <h4>Camera Parameters</h4>
      <table class="camera-table">
        <tr><th>Make</th><td>{{ selectedItem?.Camera?.Make || '-' }}</td></tr>
        <tr><th>Model</th><td>{{ selectedItem?.Camera?.Model || '-' }}</td></tr>
        <tr><th>Focal length</th><td>{{ formatCameraValue(selectedItem?.Camera?.FocalLength) }}</td></tr>
        <tr><th>Aperture</th><td>{{ formatCameraValue(selectedItem?.Camera?.Aperture) }}</td></tr>
        <tr><th>ISO</th><td>{{ formatCameraValue(selectedItem?.Camera?.ISO) }}</td></tr>
        <tr><th>Shutter speed</th><td>{{ formatCameraValue(selectedItem?.Camera?.ExposureTime) }}</td></tr>
        <tr><th>Flash</th><td>{{ formatFlashUsed(selectedItem?.Camera?.FlashUsed) }}</td></tr>
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
          data-tip="Play"
          aria-label="Play"
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
        <img :src="selectedItem?.__thumbnailAvailable ? buildImageUrl(selectedItem.__thumbnailPath) : ICONS.videoPlaceholder" alt="Video thumbnail" />
        <p>{{ videoPlaybackMessage || 'Playing audio only' }}</p>
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
          @playing="onMediaPlaying"
          @pause="onMediaPaused"
          @ended="onMediaEnded"
          @timeupdate="onMediaTimeUpdate"
          @seeked="onMediaTimeUpdate"
        ></audio>
      </div>
      <div v-else class="video-fallback-panel video-unsupported-panel">
        <img :src="selectedItem?.__thumbnailAvailable ? buildImageUrl(selectedItem.__thumbnailPath) : ICONS.videoPlaceholder" alt="Video thumbnail" />
        <p>{{ videoPlaybackMessage || selectedItem?.Video?.ProbeError || 'This player cannot play the media' }}</p>
        <div class="video-fallback-actions"><button class="btn btn-primary" @click.stop="openCurrentWithSystem">Open in System Player</button><button class="btn" @click.stop="showCurrentInFolder">Show in File Explorer</button></div>
      </div>
    </div>
    <button class="nav-btn right" @click="switchPhoto(1)">▶</button>
    <div v-if="showContextMenu" class="context-menu" :style="{ left: contextPosition.x + 'px', top: contextPosition.y + 'px' }" @click.stop>
      <button v-if="!isSelectedVideo" @click="contextCopyImage">Copy Image</button><button @click="contextCopyPath">Copy File Path</button><button @click="contextCopyJson">Copy Media Metadata JSON</button><button @click="openCurrentWithSystem">Open with Default App</button><button @click="showCurrentInFolder">Show in File Explorer</button>
    </div>
  </section>
  <aside class="side-panel right-panel" :class="{ collapsed: !showRightPanel, 'is-saving': saving }" :inert="saving ? '' : undefined" :aria-busy="saving">
    <h3>Customization</h3>
    <label>Title</label><textarea class="input field-textarea viewer-title-input" v-model="editDraft.Title" @input="onFieldTextareaInput($event, 'Title')" @keydown.ctrl.enter.exact="confirmTextEdit" @keydown.escape="blurTextEdit" rows="1"></textarea>
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'Title'"><span class="confirm-text">Save changes?</span><button class="btn btn-primary" @click="confirmEdit">Yes</button><button class="btn" @click="cancelEdit">No</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'Title'">{{ saveNotice.message }}</div>
    <div class="viewer-field-heading">
      <label>Rating</label>
      <button
        type="button"
        class="viewer-detail-toggle"
        :aria-expanded="privacyExpanded"
        :aria-label="privacyExpanded ? 'Collapse privacy level' : 'Expand privacy level'"
        :data-tip="privacyExpanded ? 'Collapse privacy level' : 'Expand privacy level'"
        @click="privacyExpanded = !privacyExpanded"
      >
        <span class="viewer-detail-chevron" :class="{ expanded: privacyExpanded }">&gt;</span>
      </button>
    </div>
    <div class="rating-stars" role="radiogroup" aria-label="Rating">
      <button
        v-for="star in STAR_LEVELS"
        :key="'rating_star_' + star"
        type="button"
        class="star-btn"
        :class="{ active: star <= editDraft.Rating }"
        :aria-label="star + '-star rating'"
        @click="setRating(star)"
      >★</button>
    </div>
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'Rating'"><span class="confirm-text">Save changes?</span><button class="btn btn-primary" @click="confirmEdit">Yes</button><button class="btn" @click="cancelEdit">No</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'Rating'">{{ saveNotice.message }}</div>
    <template v-if="privacyExpanded">
      <label>Privacy level</label>
      <PrivacyLevelPicker :model-value="editDraft.Privacy" @update:model-value="setPrivacy" />
    </template>
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'Privacy'"><span class="confirm-text">Save changes?</span><button class="btn btn-primary" @click="confirmEdit">Yes</button><button class="btn" @click="cancelEdit">No</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'Privacy'">{{ saveNotice.message }}</div>
    <label>Album</label>
    <AlbumPicker target="viewer" placeholder="Search albums" />
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'Album'"><span class="confirm-text">Save changes?</span><button class="btn btn-primary" @click="confirmEdit">Yes</button><button class="btn" @click="cancelEdit">No</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'Album'">{{ saveNotice.message }}</div>
    <div class="viewer-field-heading">
      <label>Location</label>
      <button
        type="button"
        class="viewer-detail-toggle"
        :aria-expanded="locationDetailExpanded"
        :aria-label="locationDetailExpanded ? 'Collapse location details' : 'Expand location details'"
        :data-tip="locationDetailExpanded ? 'Collapse location details' : 'Expand location details'"
        @click="locationDetailExpanded = !locationDetailExpanded"
      >
        <span class="viewer-detail-chevron" :class="{ expanded: locationDetailExpanded }">&gt;</span>
        <span v-if="editDraft.LocationDetail && !locationDetailExpanded" class="viewer-detail-indicator" aria-hidden="true"></span>
      </button>
    </div>
    <LocationPicker target="viewer" placeholder="Add an existing location" search-placeholder="Search locations" />
    <textarea
      v-if="locationDetailExpanded"
      class="input field-textarea location-detail-input"
      v-model="editDraft.LocationDetail"
      @input="onFieldTextareaInput($event, 'Location')"
      @keydown.ctrl.enter.exact="confirmTextEdit"
      @keydown.escape="blurTextEdit"
      rows="1"
      placeholder="Enter specific location details"
    ></textarea>
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'Location'"><span class="confirm-text">Save changes?</span><button class="btn btn-primary" @click="confirmEdit">Yes</button><button class="btn" @click="cancelEdit">No</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'Location'">{{ saveNotice.message }}</div>
    <label>People</label>
    <PeoplePicker target="viewer" placeholder="Add an existing person" search-placeholder="Search people" />
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'People'"><span class="confirm-text">Save changes?</span><button class="btn btn-primary" @click="confirmEdit">Yes</button><button class="btn" @click="cancelEdit">No</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'People'">{{ saveNotice.message }}</div>
    <label>Tags</label>
    <TagPicker target="viewer" placeholder="Search tags" />
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'Tags'"><span class="confirm-text">Save changes?</span><button class="btn btn-primary" @click="confirmEdit">Yes</button><button class="btn" @click="cancelEdit">No</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'Tags'">{{ saveNotice.message }}</div>
    <div class="viewer-field-heading">
      <label>Description</label>
      <button
        type="button"
        class="viewer-detail-toggle"
        :aria-expanded="hiddenDescriptionExpanded"
        :aria-label="hiddenDescriptionExpanded ? 'Collapse hidden description' : 'Expand hidden description'"
        :data-tip="hiddenDescriptionExpanded ? 'Collapse hidden description' : 'Expand hidden description'"
        @click="hiddenDescriptionExpanded = !hiddenDescriptionExpanded"
      >
        <span class="viewer-detail-chevron" :class="{ expanded: hiddenDescriptionExpanded }">&gt;</span>
        <span v-if="editDraft.HiddenDescription && !hiddenDescriptionExpanded" class="viewer-detail-indicator" aria-hidden="true"></span>
      </button>
    </div>
    <textarea class="input textarea" v-model="editDraft.Description" @input="requestEdit('Description')" @keydown.ctrl.enter.exact="confirmTextEdit" @keydown.escape="blurTextEdit"></textarea>
    <textarea
      v-if="hiddenDescriptionExpanded"
      class="input textarea private-textarea hidden-description-input"
      v-model="editDraft.HiddenDescription"
      @input="requestEdit('HiddenDescription')"
      @keydown.ctrl.enter.exact="confirmTextEdit"
      @keydown.escape="blurTextEdit"
      placeholder="Enter a hidden description"
    ></textarea>
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'Description'"><span class="confirm-text">Save changes?</span><button class="btn btn-primary" @click="confirmEdit">Yes</button><button class="btn" @click="cancelEdit">No</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'Description'">{{ saveNotice.message }}</div>
    <div class="inline-feedback" v-if="editingDirty && activeEditField === 'HiddenDescription'"><span class="confirm-text">Save changes?</span><button class="btn btn-primary" @click="confirmEdit">Yes</button><button class="btn" @click="cancelEdit">No</button></div>
    <div class="save-notice inline-save-notice" v-if="saveNotice.visible && saveNotice.field === 'HiddenDescription'">{{ saveNotice.message }}</div>
  </aside>
</main>
<footer class="viewer-footer">
  <div class="meta-popup-wrapper"><button class="btn icon-btn" data-tip="Show or hide media information" @click="toggleLeftPanel"><img class="icon" :src="ICONS.metadataInfo" alt="Show or hide media information" /></button></div>
  <div class="viewer-tools" :class="{ 'video-tools': isSelectedVideo }">
    <template v-if="canTransformSelectedMedia">
      <button class="btn icon-btn" data-tip="Zoom in" @click="zoomIn"><img class="icon" :src="ICONS.zoomIn" alt="Zoom in" /></button>
      <button class="btn icon-btn" data-tip="Zoom out" @click="zoomOut"><img class="icon" :src="ICONS.zoomOut" alt="Zoom out" /></button>
      <button class="btn icon-btn" data-tip="Rotate clockwise" @click="rotateClockwise"><img class="icon" :src="ICONS.rotateClockwise" alt="Rotate clockwise" /></button>
      <button class="btn icon-btn" data-tip="Rotate counterclockwise" @click="rotateCounterclockwise"><img class="icon" :src="ICONS.rotateCounterclockwise" alt="Rotate counterclockwise" /></button>
      <button class="btn icon-btn" data-tip="Mirror" @click="toggleMirror"><img class="icon" :src="ICONS.mirror" alt="Mirror" /></button>
      <button class="btn icon-btn" data-tip="Reset view" @click="restoreMediaState"><img class="icon" :src="ICONS.restoreView" alt="Reset view" /></button>
      <div class="zoom-controls"><input class="input zoom-input" type="number" :min="minZoom" :max="maxZoom" v-model.number="zoomPercent" /><input class="slider" type="range" :min="minZoom" :max="maxZoom" :step="zoomStep" v-model.number="zoomPercent" /></div>
    </template>
    <template v-if="isSelectedVideo">
      <button class="btn icon-btn" data-tip="Previous frame" aria-label="Previous frame" :disabled="!canStepVideoBackward" @click="stepVideoFrame(-1)"><img class="icon" :src="ICONS.previousFrame" alt="" /></button>
      <button class="btn icon-btn" data-tip="Next frame" aria-label="Next frame" :disabled="!canStepVideoForward" @click="stepVideoFrame(1)"><img class="icon" :src="ICONS.nextFrame" alt="" /></button>
    </template>
    <button class="btn icon-btn" :data-tip="isSelectedVideo ? 'Full-screen media' : 'Full-screen image'" @click="toggleFullscreen"><img class="icon" :src="ICONS.fullscreen" :alt="isSelectedVideo ? 'Full-screen media' : 'Full-screen image'" /></button>
    <button v-if="isSelectedVideo" class="btn icon-btn" data-tip="Open in system player" aria-label="Open in system player" @click="openCurrentWithSystem"><img class="icon" :src="ICONS.openSystem" alt="" /></button>
  </div>
  <div class="right-tools">
    <button class="btn icon-btn" data-tip="Show or hide customization" @click="toggleRightPanel"><img class="icon" :src="ICONS.customization" alt="Show or hide customization" /></button>
  </div>
</footer>
<div class="tag-modal-backdrop" v-if="pendingViewerTransition.visible" @click="cancelViewerTransition">
  <section class="library-confirm-modal viewer-unsaved-modal" role="dialog" aria-modal="true" aria-labelledby="viewer-unsaved-title" @click.stop>
    <header class="tag-manager-header"><h3 id="viewer-unsaved-title">Unsaved Changes</h3></header>
    <div class="library-confirm-body">
      <p>This media item's customizations have not been saved. Save them before continuing, or discard the changes.</p>
      <div class="tag-create-actions">
        <button class="btn" :disabled="saving" @click="cancelViewerTransition">Cancel</button>
        <button class="btn" :disabled="saving" @click="discardAndContinueViewerTransition">Discard Changes</button>
        <button class="btn btn-primary" :disabled="saving" @click="saveAndContinueViewerTransition">{{ saving ? 'Saving...' : 'Save and Continue' }}</button>
      </div>
    </div>
  </section>
</div>
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
  if (value === true) return "Yes";
  if (value === false) return "No";
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
  pendingViewerTransition,
  editDraft,
  editingDirty,
  saving,
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
  cancelViewerTransition,
  saveAndContinueViewerTransition,
  discardAndContinueViewerTransition,
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

function confirmTextEdit(event) {
  if (!editingDirty.value || event.isComposing || event.repeat) return;
  event.preventDefault();
  confirmEdit();
}

function blurTextEdit(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget?.blur();
}
</script>
