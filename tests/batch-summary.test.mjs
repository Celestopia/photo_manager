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

