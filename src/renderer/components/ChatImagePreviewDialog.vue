<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="chat-image-preview-dialog"
      :aria-label="'Image preview: ' + imagePreview.name"
      @cancel.prevent="closeImagePreview"
      @click="closeImagePreview"
      @keydown.stop
    >
      <div class="chat-image-preview-content" @click.stop>
        <button
          class="chat-image-preview-close"
          type="button"
          aria-label="Close image preview"
          title="Close image preview"
          @click="closeImagePreview"
        >
          <ChatIcon name="close" />
        </button>
        <div v-if="imagePreview.loading" class="chat-image-preview-status" role="status">
          Preparing preview…
        </div>
        <div v-else-if="imagePreview.error" class="chat-image-preview-status chat-error" role="alert">
          {{ imagePreview.error }}
        </div>
        <img v-else :src="imagePreview.previewUrl" :alt="imagePreview.name" />
      </div>
    </dialog>
  </Teleport>
</template>

<script setup>
import { inject, onBeforeUnmount, onMounted, ref } from 'vue';
import { CHAT_CONTEXT } from '../context/renderer-contexts.js';
import ChatIcon from './ChatIcon.vue';

const { imagePreview, closeImagePreview } = inject(CHAT_CONTEXT);
const dialog = ref(null);

onMounted(() => dialog.value.showModal());
onBeforeUnmount(() => dialog.value?.close());
</script>
