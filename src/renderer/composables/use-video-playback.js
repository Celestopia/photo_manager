import { computed, ref } from "vue";
import {
  calculateBufferedPercent,
  calculateFrameStepTarget,
  clampVideoTime,
} from "../video-playback.mjs";

function readStoredNumber(key, fallback, min, max) {
  try {
    const raw = window.localStorage?.getItem(key);
    if (raw === null || raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  } catch {
    return fallback;
  }
}

function readStoredBoolean(key, fallback) {
  try {
    const value = window.localStorage?.getItem(key);
    return value === "true" ? true : value === "false" ? false : fallback;
  } catch {
    return fallback;
  }
}

/** Owns video/audio elements, fixed video controls, playback fallback, frame stepping, and preferences. */
export function useVideoPlayback({ api, selectedItem, showToastMessage, onExternalAction }) {
  const videoElementRef = ref(null);
  const audioElementRef = ref(null);
  const videoPlaybackMode = ref("video");
  const videoPlaybackMessage = ref("");
  const videoFrameStepping = ref(false);
  const videoCurrentTime = ref(0);
  const videoDuration = ref(0);
  const videoPlaying = ref(false);
  const videoWaiting = ref(false);
  const videoReady = ref(false);
  const videoSeeking = ref(false);
  const videoSeekPreview = ref(0);
  const videoBufferedPercent = ref(0);
  const hasVideoPlaybackStarted = ref(false);
  const videoVolume = ref(readStoredNumber("photoManager.videoVolume", 1, 0, 1));
  const videoMuted = ref(readStoredBoolean("photoManager.videoMuted", false));
  const videoPlaybackRate = ref(readStoredNumber("photoManager.videoPlaybackRate", 1, 0.25, 4));
  let resumeAfterSeek = false;

  const isSelectedVideo = computed(() => selectedItem.value?.FileSystem?.FileType === "video");
  const videoDisplayedTime = computed(() => (
    videoSeeking.value ? videoSeekPreview.value : videoCurrentTime.value
  ));
  const canStepVideoBackward = computed(() => (
    isSelectedVideo.value
    && videoPlaybackMode.value === "video"
    && !videoFrameStepping.value
    && Number(selectedItem.value?.Video?.FrameRate) > 0
    && videoDuration.value > 0
    && videoCurrentTime.value > 0
  ));
  const canStepVideoForward = computed(() => (
    isSelectedVideo.value
    && videoPlaybackMode.value === "video"
    && !videoFrameStepping.value
    && Number(selectedItem.value?.Video?.FrameRate) > 0
    && videoDuration.value > 0
    && videoCurrentTime.value < videoDuration.value
  ));

  function savePreference(key, value) {
    try {
      window.localStorage?.setItem(key, String(value));
    } catch {
      // Preferences are optional application-local UI state.
    }
  }

  function applyVideoPreferences(element) {
    if (!element) return;
    element.volume = Math.min(1, Math.max(0, Number(videoVolume.value)));
    element.muted = Boolean(videoMuted.value);
    element.playbackRate = Math.min(4, Math.max(0.25, Number(videoPlaybackRate.value)));
  }

  function resetRuntimePlaybackState() {
    videoFrameStepping.value = false;
    videoCurrentTime.value = 0;
    videoDuration.value = 0;
    videoPlaying.value = false;
    videoWaiting.value = false;
    videoReady.value = false;
    videoSeeking.value = false;
    videoSeekPreview.value = 0;
    videoBufferedPercent.value = 0;
    hasVideoPlaybackStarted.value = false;
    resumeAfterSeek = false;
  }

  function releaseCurrentMedia() {
    for (const element of [videoElementRef.value, audioElementRef.value]) {
      if (!element) continue;
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    videoElementRef.value = null;
    audioElementRef.value = null;
    resetRuntimePlaybackState();
  }

  function resetVideoPlaybackState(item) {
    const status = item?.Video?.ProbeStatus;
    videoPlaybackMode.value = status === "failed" ? "unsupported" : status === "audio-only" ? "audio" : "video";
    videoPlaybackMessage.value = status === "failed"
      ? (item?.Video?.ProbeError || "视频无法解析")
      : status === "audio-only"
        ? "此媒体不包含视频画面，当前仅播放音频"
        : "";
    resetRuntimePlaybackState();
  }

  function currentPlaybackElement(event, elementRef) {
    const element = event?.currentTarget || elementRef.value;
    if (!element) return null;
    const eventMediaId = String(element.dataset?.mediaId || "");
    const selectedMediaId = String(selectedItem.value?.MediaId || "");
    return eventMediaId && eventMediaId === selectedMediaId ? element : null;
  }

  function reportPlaybackFallback(mode, message) {
    api.reportPlaybackIssue?.({ mediaId: selectedItem.value?.MediaId, mode, message });
  }

  function updateBufferedState(element) {
    const duration = Number.isFinite(element?.duration) ? element.duration : videoDuration.value;
    const ranges = element?.buffered;
    let end = 0;
    try {
      end = ranges?.length ? ranges.end(ranges.length - 1) : 0;
    } catch {
      end = 0;
    }
    videoBufferedPercent.value = calculateBufferedPercent(end, duration);
  }

  function syncVideoTimeline(element, { forceCurrentTime = false } = {}) {
    if (!element) return;
    const duration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 0;
    videoDuration.value = duration;
    if (!videoSeeking.value || forceCurrentTime) {
      videoCurrentTime.value = clampVideoTime(element.currentTime, duration);
    }
    updateBufferedState(element);
  }

  function onVideoLoadedMetadata(event) {
    const element = currentPlaybackElement(event, videoElementRef);
    if (!element) return;
    applyVideoPreferences(element);
    videoReady.value = true;
    videoWaiting.value = false;
    syncVideoTimeline(element, { forceCurrentTime: true });
    if (!element.videoWidth && selectedItem.value?.Video?.HasAudio) {
      element.pause();
      videoPlaybackMode.value = "audio";
      videoPlaybackMessage.value = "视频画面无法解码，当前仅播放音频";
      reportPlaybackFallback("audio", videoPlaybackMessage.value);
    }
  }

  function onVideoCanPlay(event) {
    if (!currentPlaybackElement(event, videoElementRef)) return;
    videoReady.value = true;
    videoWaiting.value = false;
  }

  function onVideoWaiting(event) {
    if (!currentPlaybackElement(event, videoElementRef) || videoSeeking.value) return;
    videoWaiting.value = true;
  }

  function onVideoProgress(event) {
    const element = currentPlaybackElement(event, videoElementRef);
    if (element) updateBufferedState(element);
  }

  function onVideoDurationChange(event) {
    const element = currentPlaybackElement(event, videoElementRef);
    if (element) syncVideoTimeline(element);
  }

  function onVideoPlaybackError(event) {
    const element = currentPlaybackElement(event, videoElementRef);
    if (!element) return;
    element.pause();
    videoPlaying.value = false;
    videoWaiting.value = false;
    videoReady.value = false;
    if (selectedItem.value?.Video?.HasAudio) {
      videoPlaybackMode.value = "audio";
      videoPlaybackMessage.value = "视频画面无法解码，当前仅播放音频";
    } else {
      videoPlaybackMode.value = "unsupported";
      videoPlaybackMessage.value = "当前播放器无法解码此视频";
    }
    reportPlaybackFallback(videoPlaybackMode.value, videoPlaybackMessage.value);
  }

  function onAudioLoadedMetadata(event) {
    const element = currentPlaybackElement(event, audioElementRef);
    if (element) applyVideoPreferences(element);
  }

  function onAudioPlaybackError(event) {
    if (!currentPlaybackElement(event, audioElementRef)) return;
    videoPlaybackMode.value = "unsupported";
    videoPlaybackMessage.value = "当前播放器无法解码此媒体";
    videoPlaying.value = false;
    videoWaiting.value = false;
    reportPlaybackFallback("unsupported", videoPlaybackMessage.value);
  }

  function onVideoVolumeChange(event) {
    const element = currentPlaybackElement(
      event,
      event?.currentTarget?.tagName === "AUDIO" ? audioElementRef : videoElementRef,
    );
    if (!element) return;
    videoVolume.value = element.volume;
    videoMuted.value = element.muted;
    savePreference("photoManager.videoVolume", videoVolume.value);
    savePreference("photoManager.videoMuted", videoMuted.value);
  }

  function onVideoRateChange(event) {
    const element = currentPlaybackElement(
      event,
      event?.currentTarget?.tagName === "AUDIO" ? audioElementRef : videoElementRef,
    );
    if (!element || !Number.isFinite(element.playbackRate)) return;
    const rate = Math.min(4, Math.max(0.25, element.playbackRate));
    if (element.playbackRate !== rate) {
      element.playbackRate = rate;
      return;
    }
    videoPlaybackRate.value = rate;
    savePreference("photoManager.videoPlaybackRate", rate);
  }

  function onMediaPlaying(event) {
    const elementRef = event?.currentTarget?.tagName === "AUDIO" ? audioElementRef : videoElementRef;
    if (!currentPlaybackElement(event, elementRef)) return;
    hasVideoPlaybackStarted.value = true;
    videoPlaying.value = true;
    videoWaiting.value = false;
  }

  function onMediaPaused(event) {
    const elementRef = event?.currentTarget?.tagName === "AUDIO" ? audioElementRef : videoElementRef;
    if (currentPlaybackElement(event, elementRef)) videoPlaying.value = false;
  }

  function onMediaEnded(event) {
    const elementRef = event?.currentTarget?.tagName === "AUDIO" ? audioElementRef : videoElementRef;
    if (!currentPlaybackElement(event, elementRef)) return;
    videoPlaying.value = false;
    videoWaiting.value = false;
  }

  function onMediaTimeUpdate(event) {
    const elementRef = event?.currentTarget?.tagName === "AUDIO" ? audioElementRef : videoElementRef;
    const element = currentPlaybackElement(event, elementRef);
    if (!element) return;
    const currentTime = Number.isFinite(element.currentTime) ? element.currentTime : 0;
    if (currentTime > 0) hasVideoPlaybackStarted.value = true;
    if (element.tagName === "VIDEO") syncVideoTimeline(element);
  }

  function onVideoSeeked(event) {
    const element = currentPlaybackElement(event, videoElementRef);
    if (!element) return;
    syncVideoTimeline(element);
    if (!videoSeeking.value) videoWaiting.value = false;
  }

  async function toggleVideoPlayback() {
    const element = videoElementRef.value || audioElementRef.value;
    if (!element) return;
    if (element.paused) {
      videoWaiting.value = element.tagName === "VIDEO";
      try {
        await element.play();
      } catch (error) {
        videoWaiting.value = false;
        showToastMessage(`播放失败：${error?.message || "未知错误"}`);
      }
    } else {
      element.pause();
    }
  }

  function seekVideo(seconds) {
    const element = videoElementRef.value || audioElementRef.value;
    if (!element || !Number.isFinite(element.duration)) return;
    element.currentTime = clampVideoTime(element.currentTime + seconds, element.duration);
    if (element.tagName === "VIDEO") syncVideoTimeline(element, { forceCurrentTime: true });
  }

  function beginVideoSeek() {
    const element = videoElementRef.value;
    if (!element || !Number.isFinite(element.duration) || element.duration <= 0) return;
    if (!videoSeeking.value) {
      resumeAfterSeek = !element.paused && !element.ended;
      if (resumeAfterSeek) element.pause();
    }
    videoSeeking.value = true;
    videoSeekPreview.value = clampVideoTime(element.currentTime, element.duration);
  }

  function previewVideoSeek(value) {
    const element = videoElementRef.value;
    if (!element || !Number.isFinite(element.duration) || element.duration <= 0) return;
    if (!videoSeeking.value) beginVideoSeek();
    const target = clampVideoTime(value, element.duration);
    videoSeekPreview.value = target;
    videoCurrentTime.value = target;
    if (target > 0) hasVideoPlaybackStarted.value = true;
    element.currentTime = target;
  }

  async function commitVideoSeek(value) {
    const element = videoElementRef.value;
    if (!element || !Number.isFinite(element.duration) || element.duration <= 0) return;
    const target = clampVideoTime(value, element.duration);
    const shouldResume = resumeAfterSeek;
    element.currentTime = target;
    videoCurrentTime.value = target;
    videoSeekPreview.value = target;
    videoSeeking.value = false;
    resumeAfterSeek = false;
    if (target > 0) hasVideoPlaybackStarted.value = true;
    if (shouldResume) {
      try {
        await element.play();
      } catch (error) {
        videoWaiting.value = false;
        showToastMessage(`播放失败：${error?.message || "未知错误"}`);
      }
    }
  }

  function toggleVideoMuted() {
    const element = videoElementRef.value;
    const muted = !videoMuted.value;
    videoMuted.value = muted;
    if (element) element.muted = muted;
    savePreference("photoManager.videoMuted", muted);
  }

  function setVideoVolume(value) {
    const volume = Math.min(1, Math.max(0, Number(value) || 0));
    videoVolume.value = volume;
    if (volume > 0) videoMuted.value = false;
    const element = videoElementRef.value;
    if (element) {
      element.volume = volume;
      if (volume > 0) element.muted = false;
    }
    savePreference("photoManager.videoVolume", volume);
    if (volume > 0) savePreference("photoManager.videoMuted", false);
  }

  function stepVideoFrame(direction) {
    const element = videoElementRef.value;
    const frameRate = Number(selectedItem.value?.Video?.FrameRate);
    if (!element || videoFrameStepping.value) return;
    const targetTime = calculateFrameStepTarget(element.currentTime, element.duration, frameRate, direction);
    if (targetTime === null) return;
    hasVideoPlaybackStarted.value = true;
    if (Math.abs(targetTime - element.currentTime) < Number.EPSILON) return;
    element.pause();
    videoFrameStepping.value = true;
    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      syncVideoTimeline(element, { forceCurrentTime: true });
      videoFrameStepping.value = false;
    };
    element.addEventListener("seeked", () => {
      if (typeof element.requestVideoFrameCallback === "function") element.requestVideoFrameCallback(finish);
      else finish();
    }, { once: true });
    element.currentTime = targetTime;
    window.setTimeout(finish, 1000);
  }

  async function openCurrentWithSystem() {
    if (!selectedItem.value) return;
    const result = await api.openWithSystem(selectedItem.value.MediaId);
    if (!result?.ok) showToastMessage(`打开失败：${result?.error || "未知错误"}`);
    onExternalAction?.();
  }

  async function showCurrentInFolder() {
    if (!selectedItem.value) return;
    const result = await api.showInFolder(selectedItem.value.MediaId);
    if (!result?.ok) showToastMessage(`定位失败：${result?.error || "未知错误"}`);
    onExternalAction?.();
  }

  return {
    videoElementRef,
    audioElementRef,
    videoPlaybackMode,
    videoPlaybackMessage,
    videoFrameStepping,
    videoCurrentTime,
    videoDuration,
    videoDisplayedTime,
    videoPlaying,
    videoWaiting,
    videoReady,
    videoSeeking,
    videoBufferedPercent,
    hasVideoPlaybackStarted,
    videoVolume,
    videoMuted,
    videoPlaybackRate,
    isSelectedVideo,
    canStepVideoBackward,
    canStepVideoForward,
    releaseCurrentMedia,
    resetVideoPlaybackState,
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
    seekVideo,
    beginVideoSeek,
    previewVideoSeek,
    commitVideoSeek,
    toggleVideoMuted,
    setVideoVolume,
    stepVideoFrame,
    openCurrentWithSystem,
    showCurrentInFolder,
  };
}
