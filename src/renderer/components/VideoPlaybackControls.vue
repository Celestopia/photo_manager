<template>
  <div class="video-playback-controls" role="group" aria-label="视频播放控件">
    <button
      type="button"
      class="video-control-button"
      :data-tip="playing ? '暂停' : '播放'"
      :aria-label="playing ? '暂停' : '播放'"
      :disabled="!ready"
      @click="$emit('toggle-play')"
    >
      <span v-if="waiting" class="video-control-spinner" aria-hidden="true"></span>
      <img v-else :src="playing ? icons.videoPause : icons.videoPlay" alt="" />
    </button>
    <span class="video-time video-time-current">{{ formatPlaybackTime(currentTime) }}</span>
    <input
      class="video-progress-slider"
      type="range"
      min="0"
      :max="Math.max(0, duration)"
      step="0.001"
      :value="currentTime"
      :disabled="duration <= 0"
      :style="progressStyle"
      aria-label="播放进度"
      @pointerdown="$emit('seek-start')"
      @pointerup="$emit('seek-commit', Number($event.target.value))"
      @input="$emit('seek-input', Number($event.target.value))"
      @change="$emit('seek-commit', Number($event.target.value))"
    />
    <span class="video-time">{{ formatPlaybackTime(duration) }}</span>
    <button
      type="button"
      class="video-control-button"
      :data-tip="muted ? '取消静音' : '静音'"
      :aria-label="muted ? '取消静音' : '静音'"
      @click="$emit('toggle-muted')"
    >
      <img :src="muted || volume === 0 ? icons.videoMuted : icons.videoVolume" alt="" />
    </button>
    <input
      class="video-volume-slider"
      type="range"
      min="0"
      max="1"
      step="0.01"
      :value="muted ? 0 : volume"
      aria-label="音量"
      @input="$emit('volume-input', Number($event.target.value))"
    />
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  icons: { type: Object, required: true },
  playing: { type: Boolean, default: false },
  ready: { type: Boolean, default: false },
  waiting: { type: Boolean, default: false },
  currentTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  bufferedPercent: { type: Number, default: 0 },
  volume: { type: Number, default: 1 },
  muted: { type: Boolean, default: false },
});

defineEmits([
  "toggle-play",
  "seek-start",
  "seek-input",
  "seek-commit",
  "toggle-muted",
  "volume-input",
]);

const progressStyle = computed(() => {
  const duration = Number(props.duration);
  const current = Number(props.currentTime);
  const played = duration > 0 && Number.isFinite(current)
    ? Math.min(100, Math.max(0, (current / duration) * 100))
    : 0;
  const buffered = Math.max(played, Math.min(100, Math.max(0, Number(props.bufferedPercent) || 0)));
  return {
    "--video-played-percent": `${played}%`,
    "--video-buffered-percent": `${buffered}%`,
  };
});

function formatPlaybackTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
</script>
