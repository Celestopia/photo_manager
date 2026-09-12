import test from 'node:test';
import assert from 'node:assert/strict';
import { ref } from 'vue';
import { useGallerySelection } from '../src/renderer/composables/use-gallery-selection.js';
test('batch selection sums selected file sizes and clears the total', () => {
  const orderedItems = ref([{ MediaId: 'a', FileSystem: { FileSize: 1024 } }, { MediaId: 'b', FileSystem: { FileSize: 2048 } }]);
  const selection = useGallerySelection({ orderedItems, galleryGroups: ref([]), resetBatchPickers() {} });
  selection.enterSelectionMode();
  selection.selectAllGalleryPhotos();
  assert.equal(selection.selectedGalleryBytes.value, 3072);
  selection.toggleGallerySelection('a');
  assert.equal(selection.selectedGalleryBytes.value, 2048);
  selection.clearGallerySelection();
  assert.equal(selection.selectedGalleryBytes.value, 0);
});

test('batch copy uses gallery order and retains the current selection', async () => {
  const orderedItems = ref([{ MediaId: 'a' }, { MediaId: 'b' }, { MediaId: 'c' }]);
  let payload;
  const messages = [];
  const selection = useGallerySelection({
    api: { copyFiles: async value => { payload = value; return { ok: true, copiedCount: 2 }; } },
    orderedItems,
    galleryGroups: ref([]),
    resetBatchPickers() {},
    showToastMessage: message => messages.push(message),
  });
  selection.enterSelectionMode();
  selection.toggleGallerySelection('c');
  selection.toggleGallerySelection('a');
  await selection.copySelectedFiles();
  assert.deepEqual(payload, { mediaIds: ['a', 'c'] });
  assert.deepEqual([...selection.gallerySelection.value], ['c', 'a']);
  assert.equal(selection.isSelectionMode.value, true);
  assert.equal(messages.at(-1), '2 files copied to the clipboard');
});

