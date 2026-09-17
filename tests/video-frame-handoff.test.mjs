import test from 'node:test';
import assert from 'node:assert/strict';
import { ref } from 'vue';
import { useVideoPlayback } from '../src/renderer/composables/use-video-playback.js';

test('metadata keeps the cover visible; decoded playback owns the display until media changes', async () => {
  const previous = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => null }, requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame() {} };
  try {
    const selectedItem = ref({ MediaId: 'one', FileSystem: { FileType: 'video' }, Video: {} });
    const playback = useVideoPlayback({ api: {}, selectedItem, showToastMessage() {} });
    let callback;
    const element = { dataset: { mediaId: 'one' }, tagName: 'VIDEO', paused: true, readyState: 2, currentTime: 0, duration: 20,
      videoWidth: 1280, videoHeight: 720, buffered: { length: 0 }, seeking: false,
      requestVideoFrameCallback: fn => { callback = fn; return 1; }, cancelVideoFrameCallback() {},
      play: async () => {}, pause() {}, removeAttribute() {}, load() {} };
    playback.videoElementRef.value = element;
    const current = playback.videoElementRef.value;
    playback.onVideoLoadedMetadata({ currentTarget: current });
    assert.equal(playback.videoFrameVisible.value, false);
    await playback.toggleVideoPlayback();
    assert.equal(playback.hasVideoPlaybackStarted.value, true);
    assert.equal(playback.videoFrameVisible.value, false, 'Play intent alone does not hide the cover');
    callback();
    assert.equal(playback.videoFrameVisible.value, true);
    playback.onMediaPaused({ currentTarget: current });
    assert.equal(playback.videoFrameVisible.value, true);
    const stale = callback;
    playback.releaseCurrentMedia();
    selectedItem.value = { ...selectedItem.value, MediaId: 'two' };
    stale();
    assert.equal(playback.videoFrameVisible.value, false);
  } finally { globalThis.window = previous; }
});
