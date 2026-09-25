<template>
    <AppDialog class="provider-dialog conversation-action-dialog" :title="batch ? `Delete ${remaining.length} conversations?` : deleting ? 'Delete conversation?' : 'Rename conversation'" :busy="working" dismiss-on-escape @close="dismiss" @opened="focusAction">
      <form @submit.prevent="submit">

        <p v-if="batch" class="conversation-delete-description">Permanently delete the selected conversations and their imported attachments? This cannot be undone. Original library media are preserved.<template v-if="includesActive"> The current conversation is included; it will be cleared.</template></p>
        <p v-else-if="deleting" class="conversation-delete-description">Delete “{{ action.row.title }}” and its imported attachments? This cannot be undone. Original library files are preserved.</p>
        <div v-else class="provider-fields"><label>Conversation title<input ref="titleInput" v-model="title" required maxlength="200" :disabled="working" /></label></div>
        <div v-if="failure" class="provider-banner provider-banner-error" role="alert">{{ failure }}<button type="button" aria-label="Dismiss notification" @click="failure = ''"><ChatIcon name="close" /></button></div>
        <footer><button class="btn" ref="cancelButton" type="button" :disabled="working" @click="dismiss">Cancel</button><button class="btn" :class="deleting ? 'danger-delete-btn' : 'btn-primary'" :disabled="working || (!deleting && !title.trim())">{{ working ? 'Please wait…' : deleting ? 'Delete' : 'Save' }}</button></footer>
      </form>
    </AppDialog>
</template>
<script setup>
import AppDialog from './dialogs/AppDialog.vue';
import { computed, inject, ref, onBeforeUnmount, watch } from 'vue';
import { CHAT_CONTEXT } from '../context/renderer-contexts';
import ChatIcon from './ChatIcon.vue';
const props = defineProps({ action: { type: Object, required: true } });
const emit = defineEmits(['close']);
const { working, error, renameTitle, rename, removeSession, removeSessions, session } = inject(CHAT_CONTEXT);
const batch = computed(() => props.action.kind === 'delete-many');
const deleting = computed(() => batch.value || props.action.kind === 'delete');
const remaining = ref(props.action.rows?.map(row => row.sessionId) || []);
const includesActive = computed(() => remaining.value.includes(session.value?.sessionId));
const title = ref(props.action.row?.title || '');
const titleInput = ref(null), cancelButton = ref(null), failure = ref('');
let timer;
watch(failure, value => { clearTimeout(timer); if (value) timer = setTimeout(() => { failure.value = ''; }, 10000); });
function dismiss() { if (!working.value) emit('close'); }
async function submit() {
  if (working.value) return;
  if (batch.value) {
    const result = await removeSessions(remaining.value);
    if (result) remaining.value = result.failed;
  }
  else if (deleting.value) await removeSession(props.action.row.sessionId);
  else { renameTitle.value = title.value.trim(); await rename(props.action.row.sessionId); }
  if (error.value) failure.value = error.value;
  else emit('close');
}
function focusAction() { if (deleting.value) cancelButton.value.focus(); else { titleInput.value.focus(); titleInput.value.select(); } }
onBeforeUnmount(() => { clearTimeout(timer); });
</script>
