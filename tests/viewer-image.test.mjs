import test from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, ref, nextTick } from 'vue';
import { useViewerImage } from '../src/renderer/composables/use-viewer-image.js';

test('photos and covers have immediate URLs; only selected failures repair and stale replies are ignored', async () => {
  const pending = [], cancelled = [];
  const api = { request: request => new Promise(resolve => pending.push({ request, resolve })), cancel: async id => cancelled.push(id) };
  const a = { MediaId: 'a', SHA256Hash: 'a', FileSystem: { FileType: 'video' }, __viewerImageUrl: 'viewer-image://library/a?v=0' };
  const b = { ...a, MediaId: 'b', SHA256Hash: 'b', __viewerImageUrl: 'viewer-image://library/b?v=0' };
  const selectedItem = ref(a), orderedItems = ref([a, b]);
  const libraryState = ref({ active: { libraryId: 'library' } }), view = ref('viewer');
  const scope = effectScope();
  const image = scope.run(() => useViewerImage({ api, selectedItem, libraryState, view, orderedItems }));
  assert.equal(image.imageUrl.value, a.__viewerImageUrl);
  assert.equal(pending.length, 0);
  void image.imageFailed(image.imageUrl.value);
  void image.imageFailed(image.imageUrl.value);
  assert.equal(pending.length, 1);
  selectedItem.value = b;
  pending[0].resolve({ ...pending[0].request, libraryId: 'library', status: 'ready', url: 'viewer-image://library/a?v=1' });
  await nextTick();
  assert.equal(image.imageUrl.value, b.__viewerImageUrl);
  void image.imageFailed(image.imageUrl.value);
  pending[1].resolve({ ...pending[1].request, libraryId: 'library', status: 'ready', url: 'viewer-image://library/b?v=1' });
  await nextTick();
  assert.equal(image.imageUrl.value, 'viewer-image://library/b?v=1');
  await image.imageFailed(image.imageUrl.value);
  assert.equal(pending.length, 2, 'Repair is bounded to once per selection');
  scope.stop();
  assert.equal(cancelled.length, 2);
});

test('preloads only adjacent images within the decoded memory budget and releases them', () => {
  const images = [];
  const make = (id, width) => ({ MediaId: id, __viewerImageUrl: `viewer-image://library/${id}`, FileSystem: { FileType: 'image' }, Picture: { Width: width, Height: 2000 } });
  const items = [make('a', 2000), make('b', 2000), make('c', 20000)];
  const selectedItem = ref(items[1]), view = ref('viewer'), orderedItems = ref(items);
  const scope = effectScope();
  const image = scope.run(() => useViewerImage({ api: {}, selectedItem, view, orderedItems, libraryState: ref({}),
    createImage: () => { const value = { decode: async () => {} }; images.push(value); return value; } }));
  image.imageLoaded(image.imageUrl.value);
  assert.equal(images.length, 1);
  assert.equal(images[0].src, items[0].__viewerImageUrl);
  scope.stop();
  assert.equal(images[0].src, '');
});
