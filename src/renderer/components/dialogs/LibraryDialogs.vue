<template>
  <div class="tag-modal-backdrop" v-if="initializationConfirm.visible" @click="closeInitializationConfirm">
    <section class="library-confirm-modal" @click.stop>
      <header class="tag-manager-header"><h3>Initialize New Library</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="Close" aria-label="Close" @click="closeInitializationConfirm">×</button></header>
      <div class="library-confirm-body">
        <p>The selected directory has not been initialized as a PhotoManager library. The application will recursively scan it, including ordinary hidden directories, read every supported image and video, calculate a complete SHA-256 hash for each readable file, read image EXIF and technical information, and probe videos with FFprobe. It will create <code>.photo_manager</code> at the library root for metadata, tag/album/person/location registries, thumbnails, logs, backups, and temporary files.</p>
        <p>Initialization will not move, rename, modify, or delete original media. Large libraries may take considerable time and generate sustained disk reads and video-probing load. Do not disconnect external drives, turn off the computer, change directory permissions, or move files being processed. You may cancel initialization; cancellation deletes all incomplete management data created during this attempt. The directory must be an independent library root and cannot be inside or contain another library.</p>
        <div class="library-confirm-summary"><strong>{{ initializationConfirm.name }}</strong><span>{{ initializationConfirm.path }}</span><span>{{ initializationConfirm.mediaCount }} supported media files found</span></div>
        <label class="library-confirm-check"><input type="checkbox" v-model="initializationConfirm.acknowledged" />I understand that the application will scan the entire directory and create library management data.</label>
        <div class="tag-create-actions"><button class="btn" @click="closeInitializationConfirm">Cancel</button><button class="btn btn-primary" :disabled="!initializationConfirm.acknowledged" @click="confirmInitializeLibrary">Start Initialization</button></div>
      </div>
    </section>
  </div>

  <div class="tag-modal-backdrop" v-if="libraryInfo.visible" @click="closeLibraryInfo">
    <section class="library-info-modal" @click.stop>
      <header class="tag-manager-header"><h3>Library Information</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="Close" aria-label="Close" @click="closeLibraryInfo">×</button></header>
      <div class="library-info-grid">
        <label>Library name</label><input class="input" v-model="libraryInfo.name" maxlength="100" />
        <label>Full path</label><div class="library-info-value">{{ libraryState.active?.root }}</div>
        <label>Library UUID</label><div class="library-info-value">{{ libraryState.active?.libraryId }}</div>
        <label>Created</label><div class="library-info-value">{{ libraryState.active?.createdAt }}</div>
        <label>Updated</label><div class="library-info-value">{{ libraryState.active?.updatedAt }}</div>
        <label>Media count</label><div class="library-info-value">{{ libraryState.active?.mediaCount || 0 }} ({{ libraryState.active?.imageCount || 0 }} images / {{ libraryState.active?.videoCount || 0 }} videos)</div>
      </div>
      <div class="library-info-actions"><button class="btn" @click="openLibraryRoot">Open Library Directory</button><button class="btn" @click="openLibraryManagerDir">Open Library Data Directory</button><span class="grow"></span><button class="btn" @click="closeLibraryInfo">Cancel</button><button class="btn btn-primary" @click="saveLibraryInfo">Save</button></div>
    </section>
  </div>

  <div class="tag-modal-backdrop" v-if="maintenanceDialog.visible" @click="maintenanceDialog.running ? null : closeMaintenanceDialog()">
    <section class="maintenance-modal" @click.stop>
      <header class="tag-manager-header"><h3>{{ maintenanceDialogTitle }}</h3><button v-if="!maintenanceDialog.running" class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="Close" aria-label="Close" @click="closeMaintenanceDialog">×</button></header>
      <div v-if="!maintenanceDialog.running && !maintenanceDialog.completed" class="maintenance-options">
        <p class="maintenance-description">{{ maintenanceDialogDescription }}</p>
        <label v-if="maintenanceDialog.operation === 'verify'" class="library-confirm-check"><input type="checkbox" v-model="maintenanceDialog.reprobe" />Reprobe videos with FFprobe (slower)</label>
        <label v-if="maintenanceDialog.operation === 'thumbnails'" class="library-confirm-check"><input type="checkbox" v-model="maintenanceDialog.force" />Regenerate all thumbnails</label>
        <p v-if="maintenanceDialog.operation === 'export'">The CSV will be written to <code>.photo_manager/data/photo_metadata.csv</code> in the current library.</p>
        <div class="tag-create-actions"><button class="btn" @click="closeMaintenanceDialog">Cancel</button><button class="btn btn-primary" @click="startMaintenanceOperation">Start</button></div>
      </div>
      <div v-else class="maintenance-progress">
        <strong>{{ maintenanceDialog.progress.message || (maintenanceDialog.completed ? 'Task complete' : 'Processing') }}</strong>
        <progress v-if="maintenanceDialog.progress.total" :value="maintenanceDialog.progress.processed || 0" :max="maintenanceDialog.progress.total"></progress>
        <div class="library-progress-path" v-if="maintenanceDialog.progress.current">{{ maintenanceDialog.progress.current }}</div>
        <pre v-if="maintenanceDialog.reportText">{{ maintenanceDialog.reportText }}</pre>
        <div class="tag-create-actions" v-if="maintenanceDialog.completed"><button class="btn" @click="copyMaintenanceReport">Copy Report</button><button class="btn" @click="openLibraryLogDir">Open Logs</button><button v-if="maintenanceDialog.operation === 'export' && !maintenanceDialog.error" class="btn" @click="showMaintenanceOutput">Show CSV</button><button class="btn btn-primary" @click="closeMaintenanceDialog">Close</button></div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { inject } from "vue";
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
</script>
