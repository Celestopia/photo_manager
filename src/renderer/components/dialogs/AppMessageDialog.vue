<template>
  <Teleport to="body">
    <dialog ref="dialog" class="app-message-dialog" aria-labelledby="app-message-title" aria-describedby="app-message-body" @cancel.prevent @keydown.stop @keydown.esc.prevent>
      <header class="tag-manager-header"><h3 id="app-message-title">{{ state.title }}</h3><button class="btn icon-btn" aria-label="Close dialog" data-tip="Close" @click="settle(false)">×</button></header>
      <code v-if="state.path" class="app-message-path">{{ state.path }}</code>
      <p id="app-message-body" class="app-message-body">{{ state.message }}</p>
      <div class="library-dialog-actions">
        <button v-if="!state.notice" ref="safeButton" class="btn" @click="settle(false)">{{ state.cancelLabel }}</button>
        <button ref="actionButton" class="btn" :class="state.danger ? 'danger-delete-btn' : 'btn-primary'" @click="settle(true)">{{ state.confirmLabel }}</button>
      </div>
    </dialog>
  </Teleport>
</template>
<script setup>
import { inject, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { APP_DIALOG_CONTEXT } from "../../context/renderer-contexts.js";
const { state, settle } = inject(APP_DIALOG_CONTEXT);
const dialog = ref(null), safeButton = ref(null), actionButton = ref(null);
let opener;
watch(() => state.visible, async visible => {
  if (!visible) { dialog.value?.close(); if (opener?.isConnected) opener.focus(); return; }
  opener = document.activeElement;
  await nextTick();
  if (!state.visible || !dialog.value) return;
  dialog.value.showModal();
  (safeButton.value || actionButton.value)?.focus();
});
onBeforeUnmount(() => { settle(false); dialog.value?.close(); });
</script>
<style>
.app-message-dialog { width: min(520px, calc(100vw - 48px)); max-height: calc(100vh - 48px); overflow: auto; margin: auto; padding: 24px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg-card); color: var(--text); box-shadow: var(--shadow); }
.app-message-dialog::backdrop { background: rgba(23,55,86,.4); backdrop-filter: blur(var(--modal-backdrop-blur)); }
.app-message-path { display: block; margin-top: 16px; font-family: Consolas, monospace; overflow-wrap: anywhere; }
.app-message-body { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; margin: 20px 0; }
</style>
