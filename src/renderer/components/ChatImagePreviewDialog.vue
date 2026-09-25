<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="chat-image-preview-dialog"
      :aria-label="'Image preview: ' + imagePreview.name"
      @cancel.prevent="closeImagePreview"
      @click="closeImagePreview"
      @keydown="handleKeydown"
    >
      <div class="chat-image-preview-content" @click.stop>
        <button
          class="chat-image-preview-close"
          type="button"
          aria-label="Close image preview"
          data-tip="Close image preview"
          @click="closeImagePreview"
        >
          <ChatIcon name="close" />
        </button>
        <div class="chat-image-preview-frame">
          <button
            v-if="imagePreview.items.length > 1"
            class="chat-image-preview-nav chat-image-preview-previous"
            type="button"
            aria-label="Previous image"
            data-tip="Previous image"
            :disabled="imagePreview.index === 0"
            @click="previousImagePreview"
          >
            <ChatIcon name="previous" />
          </button>
          <button
            v-if="imagePreview.items.length > 1"
            class="chat-image-preview-nav chat-image-preview-next"
            type="button"
            aria-label="Next image"
            data-tip="Next image"
            :disabled="imagePreview.index === imagePreview.items.length - 1"
            @click="nextImagePreview"
          >
            <ChatIcon name="next" />
          </button>
          <div v-if="imagePreview.loading" class="chat-image-preview-status" role="status">
            Preparing preview…
          </div>
          <div v-else-if="imagePreview.error" class="chat-image-preview-status chat-error" role="alert">
            {{ imagePreview.error }}
          </div>
          <img v-else :src="imagePreview.previewUrl" :alt="imagePreview.name" />
          <div v-if="imagePreview.items.length > 1" class="chat-image-preview-count" aria-live="polite">
            {{ imagePreview.index + 1 }} / {{ imagePreview.items.length }}
          </div>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>

<script setup>
import { inject, onBeforeUnmount, onMounted, ref } from 'vue';
import { CHAT_CONTEXT } from '../context/renderer-contexts.js';
import ChatIcon from './ChatIcon.vue';

const {
  imagePreview,
  previousImagePreview,
  nextImagePreview,
  closeImagePreview,
} = inject(CHAT_CONTEXT);
const dialog = ref(null);

function handleKeydown(event) {
  event.stopPropagation();
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    previousImagePreview();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    nextImagePreview();
  }
}

onMounted(() => dialog.value.showModal());
onBeforeUnmount(() => dialog.value?.close());
</script>
