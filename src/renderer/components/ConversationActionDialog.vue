<template>
  <Teleport to="body">
    <dialog ref="dialog" class="provider-dialog conversation-action-dialog" aria-labelledby="conversation-action-title" @cancel.prevent="dismiss" @keydown.stop>
      <form @submit.prevent="submit">
        <header><h2 id="conversation-action-title">{{ deleting ? 'Delete conversation?' : 'Rename conversation' }}</h2><button type="button" class="provider-close" aria-label="Close dialog" :disabled="working" @click="dismiss"><ChatIcon name="close" /></button></header>
        <p v-if="deleting" class="conversation-delete-description">Delete “{{ action.row.title }}” and its imported attachments? This cannot be undone. Original library files are preserved.</p>
        <div v-else class="provider-fields"><label>Conversation title<input ref="titleInput" v-model="title" required maxlength="200" :disabled="working" /></label></div>
        <div v-if="failure" class="provider-banner provider-banner-error" role="alert">{{ failure }}<button type="button" aria-label="Dismiss notification" @click="failure = ''"><ChatIcon name="close" /></button></div>
        <footer><button ref="cancelButton" type="button" :disabled="working" @click="dismiss">Cancel</button><button :class="deleting ? 'conversation-delete-confirm' : 'provider-save'" :disabled="working || (!deleting && !title.trim())">{{ working ? 'Please wait…' : deleting ? 'Delete' : 'Save' }}</button></footer>
      </form>
    </dialog>
  </Teleport>
</template>
<script setup>
import { computed, inject, ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { CHAT_CONTEXT } from '../context/renderer-contexts';
import ChatIcon from './ChatIcon.vue';
const props = defineProps({ action: { type: Object, required: true } });
const emit = defineEmits(['close']);
const { working, error, renameTitle, rename, removeSession } = inject(CHAT_CONTEXT);
const deleting = computed(() => props.action.kind === 'delete');
const title = ref(props.action.row.title);
const dialog = ref(null), titleInput = ref(null), cancelButton = ref(null), failure = ref('');
let timer;
watch(failure, value => { clearTimeout(timer); if (value) timer = setTimeout(() => { failure.value = ''; }, 10000); });
function dismiss() { if (!working.value) emit('close'); }
async function submit() {
  if (working.value) return;
  if (deleting.value) await removeSession(props.action.row.sessionId);
  else { renameTitle.value = title.value.trim(); await rename(props.action.row.sessionId); }
  if (error.value) failure.value = error.value;
  else emit('close');
}
onMounted(() => { dialog.value.showModal(); if (deleting.value) cancelButton.value.focus(); else { titleInput.value.focus(); titleInput.value.select(); } });
onBeforeUnmount(() => { clearTimeout(timer); dialog.value?.close(); });
</script>
