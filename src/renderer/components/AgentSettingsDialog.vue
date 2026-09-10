<template>
  <dialog ref="dialog" class="agent-settings" aria-labelledby="agent-settings-title" @cancel.prevent="$emit('close')" @click="backdrop">
    <header><h3 id="agent-settings-title">Assistant settings</h3><button class="btn" aria-label="Close settings" @click="$emit('close')">×</button></header>
    <div class="settings-body">
      <p>Chat can send the selected content to your configured server. Indexing and embeddings stay on this computer.</p>
      <p>{{ s.status?.providers?.file }}</p>
      <button class="btn" @click="agent.settingsAction('agentOpenConfig')">Open configuration</button>
      <button class="btn" :disabled="s.running" @click="agent.settingsAction('agentReloadConfig')">Reload</button>
      <button class="btn" :disabled="s.running" @click="agent.settingsAction('agentTestProvider')">Test provider (synthetic image)</button>
      <p v-if="s.settingsResult" role="status">{{ s.settingsResult }}</p>
      <p v-if="s.status?.providers?.error">{{ s.status.providers.error }}</p>
      <button class="btn" @click="agent.settingsAction('agentOpenRuntimeConfig')">Open budgets and retention configuration</button>
      <details v-if="s.status?.providers?.runtime"><summary>Budgets and receipt retention</summary><p>Change these values in the configuration file, then Reload. Cost caps are estimates, not guaranteed billing totals.</p><pre>{{ JSON.stringify(s.status.providers.runtime, null, 2) }}</pre></details>
      <p v-for="model in s.status?.models" :key="model.id">{{ model.id }}: {{ model.ready ? 'Ready' : 'Not installed' }} · {{ (model.bytes / 1048576).toFixed(1) }} MiB</p>
      <p>Both model downloads total about 278 MiB. No media is uploaded to download models.</p>
      <button class="btn" :disabled="s.running" @click="agent.settingsAction('agentDownloadModels')">Download models</button>
      <button class="btn" :disabled="s.running" @click="agent.settingsAction('agentImportModels')">Import models</button>
      <p>Index: {{ s.status?.index?.vectors || 0 }} vectors; {{ s.status?.index?.failures || 0 }} failed samples/tasks</p>
      <p v-if="s.status?.indexError">{{ s.status.indexError }}</p>
      <button class="btn" :disabled="s.running" @click="agent.index()">Build / resume index</button>
      <button class="btn" :disabled="s.running" @click="agent.index('rebuild')">Rebuild index</button>
      <button class="btn" :disabled="s.running" @click="agent.history">Edit history</button>
      <details v-for="receipt in s.history" :key="receipt.operationId"><summary>{{ receipt.createdAt }} · {{ receipt.changes.length }} media · {{ receipt.undoneAt ? 'Undone' : 'Review undo' }}</summary><p>Expires: {{ receipt.expiresAt }}</p><div v-for="change in receipt.changes" :key="change.mediaId"><p>{{ change.mediaId }}</p><p v-for="(value, field) in change.before" :key="field">{{ field }}: {{ displayField(field, change.after[field]) }} → {{ displayField(field, value) }}</p></div><button class="btn" :disabled="s.running || s.applying || !!receipt.undoneAt" @click="agent.undo(receipt.operationId)">Undo reviewed changes</button></details>

    </div>
  </dialog>
</template>
<script setup>
import { inject, onMounted, onBeforeUnmount, ref } from 'vue';
import { AGENT_CONTEXT, TAG_CONTEXT } from '../context/renderer-contexts.js';
const emit = defineEmits(['close']);
const agent = inject(AGENT_CONTEXT), s = agent.state, tags = inject(TAG_CONTEXT), dialog = ref(null);
const displayField = (field, value) => field === 'TagIds' ? value.map(id => tags.getTagText(id)).join(', ') : value;
const backdrop = event => { if (event.target === dialog.value) { const r = dialog.value.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) emit('close'); } };
onMounted(() => dialog.value.showModal());
onBeforeUnmount(() => dialog.value?.close());
</script>
<style scoped>
.agent-settings { width:min(580px, calc(100vw - 48px)); max-height:80vh; padding:0; border:1px solid #d8e0e8; border-radius:14px; color:#23405a; background:white; }
.agent-settings::backdrop { background:rgb(20 35 50 / 30%); }
header { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e8edf2; } h3 { margin:0; }
.settings-body { padding:16px 20px; overflow-wrap:anywhere; } .btn { margin:3px; } p, details { font-size:13px; } pre { white-space:pre-wrap; }
</style>
