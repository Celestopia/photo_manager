import test from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, ref, nextTick } from 'vue';
import { useVideoCover } from '../src/renderer/composables/use-video-cover.js';

test('late covers cannot change a playing poster or leak across media/library selections', async () => {
  const pending = [], cancelled = [];
  const api = { request: request => new Promise(resolve => pending.push({ request, resolve })),
    cancel: async id => { cancelled.push(id); } };
  const selectedItem = ref({ MediaId: 'a', FileSystem: { FileType: 'video' } });
  const libraryState = ref({ active: { libraryId: 'library' } });
  const view = ref('viewer'), hasVideoPlaybackStarted = ref(false);
  const scope = effectScope();
  const cover = scope.run(() => useVideoCover({ api, selectedItem, libraryState, view, hasVideoPlaybackStarted }));
  hasVideoPlaybackStarted.value = true;
  pending[0].resolve({ ...pending[0].request, libraryId: 'library', status: 'ready', url: 'first' });
  await nextTick();
  assert.equal(cover.videoPosterUrl.value, '');
  assert.equal(cover.videoCoverUrl.value, 'first');
  selectedItem.value = { ...selectedItem.value, MediaId: 'b' };
  await nextTick();
  selectedItem.value = { ...selectedItem.value, MediaId: 'c' };
  await nextTick();
  hasVideoPlaybackStarted.value = false;
  pending[1].resolve({ ...pending[1].request, libraryId: 'library', status: 'ready', url: 'stale' });
  await nextTick();
  assert.equal(cover.videoPosterUrl.value, '');
  pending[2].resolve({ ...pending[2].request, libraryId: 'library', status: 'ready', url: 'current' });
  await nextTick();
  assert.equal(cover.videoPosterUrl.value, 'current');
  scope.stop();
  assert.equal(cancelled.length, 3);
});
