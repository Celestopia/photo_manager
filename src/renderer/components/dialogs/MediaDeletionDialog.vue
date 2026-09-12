<template>
  <div class="tag-modal-backdrop" v-if="deletionDialog.visible" @click="closeDeletionDialog">
    <section class="library-confirm-modal media-deletion-modal" role="dialog" aria-modal="true" aria-labelledby="media-deletion-title" @click.stop>
      <header class="tag-manager-header"><h3 id="media-deletion-title">Permanently Delete Media?</h3></header>
      <div class="library-confirm-body">
        <p v-if="deletionDialog.items.length === 1"><strong>{{ fileName(deletionDialog.items[0]) }}</strong> will be permanently removed from the filesystem and from PhotoManager metadata.</p>
        <p v-else><strong>{{ deletionDialog.items.length }} media items</strong> ({{ formatFileSize(deletionBytes) }}) will be permanently removed from the filesystem and from PhotoManager metadata.</p>
        <p class="danger-text">This action cannot be undone. PhotoManager's metadata backup does not contain the media files.</p>
        <p v-if="deletionDialog.mode === 'single' && editingDirty">Unsaved customization changes for this media item will be discarded.</p>
        <p v-if="deletionDialog.error" class="media-deletion-error">{{ deletionDialog.error }}</p>
        <div class="tag-create-actions">
          <button class="btn" :disabled="deletionDialog.busy" @click="closeDeletionDialog">Cancel</button>
          <button class="btn danger-delete-btn" :disabled="deletionDialog.busy" @click="confirmDeletion">{{ deletionDialog.busy ? 'Deleting...' : 'Delete Permanently' }}</button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { inject } from "vue";
import { MEDIA_DELETION_CONTEXT } from "../../context/renderer-contexts.js";
import { formatFileSize } from "../../domain/media-formatters.mjs";

const deletion = inject(MEDIA_DELETION_CONTEXT);
if (!deletion) throw new Error("MediaDeletionDialog must be used under App.vue provider");
const { deletionDialog, deletionBytes, editingDirty, closeDeletionDialog, confirmDeletion } = deletion;
function fileName(item) {
  return String(item?.FilePath || "media item").split(/[\\/]/).pop();
}
</script>
