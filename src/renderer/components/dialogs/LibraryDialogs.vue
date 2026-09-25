<template>
  <AppDialog v-if="initializationConfirm.visible" class="library-confirm-modal" dismiss-on-backdrop @close="closeInitializationConfirm">
      <template #header><h3>Initialize New Library</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="Close" aria-label="Close" @click="closeInitializationConfirm">×</button></template>
      <div class="library-confirm-body">
        <p>The selected directory has not been initialized as a Photo Manager library. The application will recursively scan it, including ordinary hidden directories, read every supported image and video, calculate a complete SHA-256 hash for each readable file, read image EXIF and technical information, and probe videos with FFprobe. It will create <code>.photo_manager</code> at the library root for metadata, tag/album/person/location registries, thumbnails, logs, backups, and temporary files.</p>
        <p>Initialization will not move, rename, modify, or delete original media. Large libraries may take considerable time and generate sustained disk reads and video-probing load. Do not disconnect external drives, turn off the computer, change directory permissions, or move files being processed. You may cancel initialization; cancellation deletes all incomplete management data created during this attempt. The directory must be an independent library root and cannot be inside or contain another library.</p>
        <div class="library-confirm-summary"><strong>{{ initializationConfirm.name }}</strong><span>{{ initializationConfirm.path }}</span><span>{{ initializationConfirm.mediaCount }} supported media files found</span></div>
        <label class="library-confirm-check"><input type="checkbox" v-model="initializationConfirm.acknowledged" />I understand that the application will scan the entire directory and create library management data.</label>
        <div class="tag-create-actions"><button class="btn" @click="closeInitializationConfirm">Cancel</button><button class="btn btn-primary" :disabled="!initializationConfirm.acknowledged" @click="confirmInitializeLibrary">Start Initialization</button></div>
      </div>
    </AppDialog>

  <AppDialog v-if="libraryInfo.visible" class="library-info-modal" dismiss-on-backdrop @close="closeLibraryInfo">
      <template #header><h3>Library information</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="Close" aria-label="Close" @click="closeLibraryInfo">×</button></template>
      <div class="library-info-body">
        <div id="library-name-label" class="library-field-label">Library name</div>
        <div class="library-name-row">
          <input v-if="editingName" id="library-name" ref="nameInput" class="input" v-model="libraryInfo.name" maxlength="100" aria-labelledby="library-name-label" />
          <span v-else class="library-name-text">{{ libraryInfo.name || '—' }}</span>
          <button type="button" class="btn icon-btn" :aria-pressed="editingName" :aria-label="editingName ? 'Finish editing library name' : 'Edit library name'" :data-tip="editingName ? 'Finish editing' : 'Edit library name'" @click="toggleNameEditing">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" /></svg>
          </button>
        </div>
        <div class="library-statistics">
          <div><strong>{{ formatCount(libraryState.active?.mediaCount) }}</strong><span>Media</span></div>
          <div><strong>{{ formatCount(libraryState.active?.imageCount) }}</strong><span>Photos</span></div>
          <div><strong>{{ formatCount(libraryState.active?.videoCount) }}</strong><span>Videos</span></div>
        </div>
        <dl class="library-facts">
          <div class="library-fact-wide"><dt>Library path</dt><dd>{{ libraryState.active?.root }}</dd></div>
          <div><dt>Created</dt><dd :title="libraryState.active?.createdAt">{{ formatLibraryDate(libraryState.active?.createdAt) }}</dd></div>
          <div><dt>Updated</dt><dd :title="libraryState.active?.updatedAt">{{ formatLibraryDate(libraryState.active?.updatedAt) }}</dd></div>
          <div class="library-fact-wide"><dt>Library ID</dt><dd>{{ libraryState.active?.libraryId }}</dd></div>
        </dl>
        <div class="library-folder-actions"><button class="btn" title="Open the library folder in File Explorer" @click="openLibraryRoot">Open folder</button><button class="btn" title="Open the .photo_manager data folder in File Explorer" @click="openLibraryManagerDir">Open data folder</button></div>
      </div>
      <div class="library-dialog-actions"><button class="btn" @click="closeLibraryInfo">Cancel</button><button class="btn btn-primary" :disabled="!canSaveName" @click="saveLibraryInfo">Save changes</button></div>
    </AppDialog>

  <AppDialog v-if="maintenanceDialog.visible" class="maintenance-modal" dismiss-on-backdrop :busy="maintenanceDialog.running" @close="maintenanceDialog.running ? null : closeMaintenanceDialog()">
      <template #header><h3>{{ maintenanceDialogTitle }}</h3><button v-if="!maintenanceDialog.running" class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="Close" aria-label="Close" @click="closeMaintenanceDialog">×</button></template>
      <div v-if="!maintenanceDialog.running && !maintenanceDialog.completed" class="maintenance-options">
        <p class="maintenance-description">{{ maintenanceDialogDescription }}</p>
        <label v-if="maintenanceDialog.operation === 'verify'" class="library-confirm-check"><input type="checkbox" v-model="maintenanceDialog.reprobe" /><span>Recheck video details<small>Analyze videos again for a more thorough check. This takes longer.</small></span></label>
        <label v-if="maintenanceDialog.operation === 'thumbnails'" class="library-confirm-check"><input type="checkbox" v-model="maintenanceDialog.force" /><span>Rebuild all thumbnails<small>Also replace existing thumbnails.</small></span></label>
        <label v-if="maintenanceDialog.operation === 'video-covers'" class="library-confirm-check"><input type="checkbox" v-model="maintenanceDialog.force" /><span>Rebuild all video covers<small>Also replace existing video covers.</small></span></label>
        <p v-if="maintenanceDialog.operation === 'verify'" class="library-helper">Media files, registries, and saved metadata will not be changed.</p>
        <p v-if="maintenanceDialog.operation === 'export'" class="library-helper">Saved to <code>.photo_manager/data/photo_metadata.csv</code> in this library.</p>
        <div class="library-dialog-actions"><button class="btn" @click="closeMaintenanceDialog">Cancel</button><button class="btn btn-primary" @click="startMaintenanceOperation()">{{ maintenanceAction }}</button></div>
      </div>
      <div v-else class="maintenance-progress">
        <div role="status" :class="{ 'maintenance-attention': summary.needsAttention && maintenanceDialog.completed }">
          <strong>{{ maintenanceDialog.completed ? summary.title : maintenanceDialog.progress.message || 'Processing…' }}</strong>
          <p v-if="maintenanceDialog.completed && summary.text" class="maintenance-summary">{{ summary.text }}</p>
        </div>
        <template v-if="!maintenanceDialog.completed">
          <span v-if="maintenanceDialog.progress.total" class="library-helper">{{ formatCount(maintenanceDialog.progress.processed || 0) }} / {{ formatCount(maintenanceDialog.progress.total) }}</span>
          <progress :value="maintenanceDialog.progress.total ? maintenanceDialog.progress.processed || 0 : undefined" :max="maintenanceDialog.progress.total || 1" aria-label="Operation progress"></progress>
          <div class="library-progress-path" v-if="maintenanceDialog.progress.current">{{ maintenanceDialog.progress.current }}</div>
        </template>
        <details v-if="maintenanceDialog.reportText" :key="maintenanceDialog.completed ? 'complete' : 'running'" class="library-details" :open="maintenanceDialog.completed && summary.needsAttention"><summary>Detailed report</summary><pre>{{ maintenanceDialog.reportText }}</pre></details>
        <div class="library-dialog-actions maintenance-result-actions" v-if="maintenanceDialog.completed"><button class="btn" @click="copyMaintenanceReport">Copy report</button><button class="btn" @click="openLibraryLogDir">Open logs</button><button v-if="maintenanceDialog.operation === 'export' && !maintenanceDialog.error" class="btn" @click="showMaintenanceOutput">Show CSV</button><button class="btn btn-primary" @click="closeMaintenanceDialog">Close</button></div>
      </div>
    </AppDialog>
</template>

<script setup>
import AppDialog from "./AppDialog.vue";
import { computed, inject, ref, watch, nextTick } from "vue";
import { formatLibraryDate, maintenanceSummary, MAINTENANCE_COPY } from "../../domain/library-presentation.mjs";
import { LIBRARY_CONTEXT } from "../../context/renderer-contexts.js";

const context = inject(LIBRARY_CONTEXT);
if (!context) throw new Error("LibraryDialogs requires LIBRARY_CONTEXT");
const {
  initializationConfirm, libraryInfo, libraryState, maintenanceDialog,
  maintenanceDialogTitle, maintenanceDialogDescription, closeInitializationConfirm,
  confirmInitializeLibrary, closeLibraryInfo, openLibraryRoot, openLibraryManagerDir,
  saveLibraryInfo, closeMaintenanceDialog, startMaintenanceOperation,
  copyMaintenanceReport, openLibraryLogDir, showMaintenanceOutput,
} = context;
const editingName = ref(false);
const nameInput = ref(null);
watch(() => libraryInfo.visible, () => { editingName.value = false; });
async function toggleNameEditing() {
  editingName.value = !editingName.value;
  if (editingName.value) {
    await nextTick();
    nameInput.value?.focus();
  }
}
const formatCount = value => Number.isFinite(value) ? value.toLocaleString('en-US') : '—';
const canSaveName = computed(() => {
  const name = libraryInfo.name.trim();
  return name.length > 0 && name.length <= 100 && name !== libraryState.value.active?.name;
});
const maintenanceAction = computed(() => MAINTENANCE_COPY[maintenanceDialog.operation]?.action || 'Start');
const summary = computed(() => maintenanceSummary(maintenanceDialog.operation, maintenanceDialog.result, maintenanceDialog.error));
</script>
