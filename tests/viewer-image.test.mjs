import test from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, ref, nextTick } from 'vue';
import { useViewerImage } from '../src/renderer/composables/use-viewer-image.js';

test('navigation retains destination preloads until the visible handoff', () => {
  const created = [];
  const items = ['a', 'b', 'c'].map(MediaId => ({ MediaId, __viewerImageUrl: `viewer-image://library/${MediaId}`, FileSystem: { FileType: 'image' }, Picture: { Width: 2000, Height: 2000 } }));
  const selectedItem = ref(items[0]), view = ref('viewer');
  const scope = effectScope();
  const image = scope.run(() => useViewerImage({ selectedItem, view, orderedItems: ref(items), libraryState: ref({}),
    createImage: () => { const image = { decode: async () => {} }; created.push(image); return image; } }));
  image.imageLoaded(image.imageUrl.value);
  const destination = created[0];
  selectedItem.value = items[1];
  assert.equal(destination.src, items[1].__viewerImageUrl);
  image.imageLoaded(image.imageUrl.value);
  assert.equal(destination.src, '', 'Release only after visible handoff');
  view.value = 'gallery';
  assert.ok(created.every(image => image.src === ''));
  scope.stop();
});

test('cover preload failure leaves resource URLs unchanged and creates no repair API', async () => {
  const items = ['a', 'b'].map(MediaId => ({MediaId, __viewerImageUrl:`viewer-image://library/${MediaId}`, FileSystem:{FileType:'video'}, Video:{DisplayWidth:1280,DisplayHeight:720}}));
  const selectedItem = ref(items[0]);
  const scope = effectScope();
  const images = [];
  const image = scope.run(() => useViewerImage({selectedItem, view:ref('viewer'), libraryState:ref({}), orderedItems:ref(items),
    createImage: () => { const value = {decode:async () => {throw new Error('Missing cover');}}; images.push(value); return value; } }));
  image.imageLoaded(image.imageUrl.value);
  await nextTick();
  assert.equal(images.length, 1);
  assert.equal(image.imageFailed, undefined);
  selectedItem.value = items[1];
  assert.equal(image.imageUrl.value, items[1].__viewerImageUrl);
  scope.stop();
  assert.equal(images[0].src, '');
});

test('preloads only adjacent images within the decoded memory budget and releases them', () => {
  const images = [];
  const make = (id, width) => ({ MediaId: id, __viewerImageUrl: `viewer-image://library/${id}`, FileSystem: { FileType: 'image' }, Picture: { Width: width, Height: 2000 } });
  const items = [make('a', 2000), make('b', 2000), make('c', 20000)];
  const selectedItem = ref(items[1]), view = ref('viewer'), orderedItems = ref(items);
  const scope = effectScope();
  const image = scope.run(() => useViewerImage({ selectedItem, view, orderedItems, libraryState: ref({}),
    createImage: () => { const value = { decode: async () => {} }; images.push(value); return value; } }));
  image.imageLoaded(image.imageUrl.value);
  assert.equal(images.length, 1);
  assert.equal(images[0].src, items[0].__viewerImageUrl);
  scope.stop();
  assert.equal(images[0].src, '');
});
