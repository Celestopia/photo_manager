<template>
    <AppDialog v-if="state.visible" class="app-message-dialog" aria-describedby="app-message-body" :title="state.title" initial-focus="[data-dialog-primary-focus]" @close="settle(false)">
      <code v-if="state.path" class="app-message-path">{{ state.path }}</code>
      <p id="app-message-body" class="app-message-body">{{ state.message }}</p>
      <template #footer>
        <button v-if="!state.notice" data-dialog-primary-focus class="btn" @click="settle(false)">{{ state.cancelLabel }}</button>
        <button :data-dialog-primary-focus="state.notice ? '' : undefined" class="btn" :class="state.danger ? 'danger-delete-btn' : 'btn-primary'" @click="settle(true)">{{ state.confirmLabel }}</button>
      </template>
    </AppDialog>
</template>
<script setup>
import { inject, onBeforeUnmount } from "vue";
import AppDialog from './AppDialog.vue';
import { APP_DIALOG_CONTEXT } from "../../context/renderer-contexts.js";
const { state, settle } = inject(APP_DIALOG_CONTEXT);
onBeforeUnmount(() => settle(false));
</script>
<style>
.app-message-path { display: block; margin-top: 16px; font-family: Consolas, monospace; overflow-wrap: anywhere; }
.app-message-body { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; margin: 20px 0; }
</style>
