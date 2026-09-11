<template>
  <Teleport to="body">
    <dialog ref="dialog" class="provider-dialog" aria-labelledby="provider-title" @cancel.prevent="settings = false" @keydown.stop>
      <form @submit.prevent="saveConfiguration">
        <header><div><h2 id="provider-title">Provider settings</h2><p>Connect your preferred vision model.</p></div><button type="button" class="provider-close" aria-label="Close provider settings" @click="settings = false"><ChatIcon name="close" /></button></header>
        <div v-if="configuration" class="provider-fields">
          <label>Base URL<input v-model="configuration.baseUrl" type="url" required placeholder="https://your-provider.example/v1" :disabled="working || busy" /></label>
          <label>Model<input v-model="configuration.model" required placeholder="Vision model name" :disabled="working || busy" /></label>
          <label>API key<input v-model="configuration.apiKey" type="password" autocomplete="new-password" :placeholder="configuration.hasKey ? 'Saved key · leave blank to keep it' : 'Enter API key (optional for local servers)'" :disabled="working || busy || configuration.clearKey" /></label>
          <details><summary>Advanced options</summary>
            <label v-if="configuration.hasKey" class="provider-check"><input type="checkbox" v-model="configuration.clearKey" :disabled="working || busy" />Remove the saved API key</label>
            <label>API key environment variable<input v-model="configuration.apiKeyEnv" placeholder="Optional fallback when no key is saved" :disabled="working || busy" /></label>
            <label class="provider-check"><input type="checkbox" v-model="configuration.streaming" :disabled="working || busy" />Stream responses</label>
            <label>Model thinking<select v-model="configuration.thinking" :disabled="working || busy"><option value="omit">Use provider default</option><option value="false">Off</option><option value="true">On</option></select></label>
          </details>
          <p class="provider-help">Selected content is sent to this provider when you chat. Remote services may charge for usage. Your key is saved on this computer.</p>
        </div>
        <p v-if="error" class="chat-error" role="alert">{{ error }}</p>
        <p v-if="notice" class="provider-help" role="status">{{ notice }}</p>
        <footer><button type="button" :disabled="working || busy || !configuration" @click="testConnection">Test saved connection</button><button class="provider-save" :disabled="working || busy || !configuration">{{ working ? 'Please wait…' : 'Save settings' }}</button></footer>
        <p class="provider-footnote">Save changes before testing. The test sends only a generated blue square.</p>
      </form>
    </dialog>
  </Teleport>
</template>
<script setup>
import { inject, ref, onMounted, onBeforeUnmount } from 'vue';
import { CHAT_CONTEXT } from '../context/renderer-contexts';
import ChatIcon from './ChatIcon.vue';
const { settings, configuration, working, busy, error, notice, saveConfiguration, testConnection } = inject(CHAT_CONTEXT);
const dialog = ref(null);
onMounted(() => dialog.value.showModal());
onBeforeUnmount(() => { dialog.value?.close(); if (configuration.value) configuration.value.apiKey = ''; });
</script>
