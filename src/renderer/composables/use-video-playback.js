import { computed, ref } from "vue";
import { calculateFrameStepTarget } from "../video-playback.mjs";

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

/** Owns native video/audio elements, playback fallback, frame stepping, and preferences. */
export function useVideoPlayback({ api, selectedItem, showToastMessage, onExternalAction }) {
  const videoElementRef = ref(null);
  const audioElementRef = ref(null);
  const videoPlaybackMode = ref("video");
  const videoPlaybackMessage = ref("");
  const videoFrameStepping = ref(false);
  const videoCurrentTime = ref(0);
  const videoDuration = ref(0);
  const hasVideoPlaybackStarted = ref(false);
  const videoVolume = ref(readStoredNumber("photoManager.videoVolume", 1, 0, 1));
  const videoMuted = ref(readStoredBoolean("photoManager.videoMuted", false));
  const videoPlaybackRate = ref(readStoredNumber("photoManager.videoPlaybackRate", 1, 0.25, 4));

  const isSelectedVideo = computed(() => selectedItem.value?.FileSystem?.FileType === "video");
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

  function releaseCurrentMedia() {
    for (const element of [videoElementRef.value, audioElementRef.value]) {
      if (!element) continue;
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    videoElementRef.value = null;
    audioElementRef.value = null;
    videoFrameStepping.value = false;
    videoCurrentTime.value = 0;
    videoDuration.value = 0;
    hasVideoPlaybackStarted.value = false;
  }

  function resetVideoPlaybackState(item) {
    const status = item?.Video?.ProbeStatus;
    videoPlaybackMode.value = status === "failed" ? "unsupported" : status === "audio-only" ? "audio" : "video";
    videoPlaybackMessage.value = status === "failed"
      ? (item?.Video?.ProbeError || "视频无法解析")
      : status === "audio-only"
        ? "此媒体不包含视频画面，当前仅播放音频"
        : "";
    videoFrameStepping.value = false;
    videoCurrentTime.value = 0;
    videoDuration.value = 0;
    hasVideoPlaybackStarted.value = false;
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

  function onVideoLoadedMetadata(event) {
    const element = currentPlaybackElement(event, videoElementRef);
    if (!element) return;
    applyVideoPreferences(element);
    videoCurrentTime.value = Number.isFinite(element.currentTime) ? element.currentTime : 0;
    videoDuration.value = Number.isFinite(element.duration) ? element.duration : 0;
    if (!element.videoWidth && selectedItem.value?.Video?.HasAudio) {
      videoPlaybackMode.value = "audio";
      videoPlaybackMessage.value = "视频画面无法解码，当前仅播放音频";
      reportPlaybackFallback("audio", videoPlaybackMessage.value);
    }
  }

  function onVideoPlaybackError(event) {
    if (!currentPlaybackElement(event, videoElementRef)) return;
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

  function onMediaPlaybackStarted(event) {
    const elementRef = event?.currentTarget?.tagName === "AUDIO" ? audioElementRef : videoElementRef;
    if (currentPlaybackElement(event, elementRef)) hasVideoPlaybackStarted.value = true;
  }

  function onMediaTimeUpdate(event) {
    const elementRef = event?.currentTarget?.tagName === "AUDIO" ? audioElementRef : videoElementRef;
    const element = currentPlaybackElement(event, elementRef);
    if (!element) return;
    const currentTime = Number.isFinite(element.currentTime) ? element.currentTime : 0;
    if (currentTime > 0) hasVideoPlaybackStarted.value = true;
    if (element.tagName === "VIDEO") {
      videoCurrentTime.value = currentTime;
      videoDuration.value = Number.isFinite(element.duration) ? element.duration : 0;
    }
  }

  async function toggleVideoPlayback() {
    const element = videoElementRef.value || audioElementRef.value;
    if (!element) return;
    if (element.paused) {
      try {
        await element.play();
      } catch (error) {
        showToastMessage(`播放失败：${error?.message || "未知错误"}`);
      }
    } else {
      element.pause();
    }
  }

  function seekVideo(seconds) {
    const element = videoElementRef.value || audioElementRef.value;
    if (!element || !Number.isFinite(element.duration)) return;
    element.currentTime = Math.min(element.duration, Math.max(0, element.currentTime + seconds));
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
      videoCurrentTime.value = Number.isFinite(element.currentTime) ? element.currentTime : 0;
      videoDuration.value = Number.isFinite(element.duration) ? element.duration : 0;
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
    onVideoPlaybackError,
    onAudioLoadedMetadata,
    onAudioPlaybackError,
    onVideoVolumeChange,
    onVideoRateChange,
    onMediaPlaybackStarted,
    onMediaTimeUpdate,
    toggleVideoPlayback,
    seekVideo,
    stepVideoFrame,
    openCurrentWithSystem,
    showCurrentInFolder,
  };
}
