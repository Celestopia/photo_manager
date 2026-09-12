<template>
  <Teleport to="body">
    <dialog ref="dialog" class="provider-dialog" aria-labelledby="provider-title" @cancel.prevent="settings = false" @keydown.stop>
      <div v-if="banner" class="provider-banner" :class="'provider-banner-' + banner.kind" :role="banner.kind === 'error' ? 'alert' : 'status'" aria-live="polite">
        <span aria-hidden="true">{{ banner.kind === 'success' ? '✓' : banner.kind === 'error' ? '!' : 'ⓘ' }}</span>
        <span>{{ banner.text }}</span>
        <button v-if="!operation" type="button" aria-label="Dismiss notification" @click="banner = null"><ChatIcon name="close" /></button>
      </div>
      <form @submit.prevent="runOperation('save')">
        <header><div><h2 id="provider-title">Provider settings</h2><p>Connect your preferred vision model.</p></div><button type="button" class="provider-close" aria-label="Close provider settings" @click="settings = false"><ChatIcon name="close" /></button></header>
        <div v-if="configuration" class="provider-fields">
          <label>Base URL<input v-model="configuration.baseUrl" type="url" required placeholder="https://your-provider.example/v1" :disabled="working || busy" /></label>
          <label>Model<input v-model="configuration.model" required placeholder="Vision model name" :disabled="working || busy" /></label>
          <label>API key<input v-model="configuration.apiKey" type="password" autocomplete="new-password" :placeholder="configuration.hasKey ? 'Saved key · leave blank to keep it' : 'Enter API key (optional for local servers)'" :disabled="working || busy || configuration.clearKey" /></label>
          <div v-if="configuration.hasKey" class="provider-key-action">
            <button type="button" :disabled="working || busy" @click="toggleKeyRemoval">{{ configuration.clearKey ? 'Undo removal' : 'Remove saved key' }}</button>
          </div>
          <details><summary>Advanced options</summary>
            <label>API key environment variable<input v-model="configuration.apiKeyEnv" placeholder="Optional fallback when no key is saved" :disabled="working || busy" /></label>
            <label>Model thinking<select v-model="configuration.thinking" :disabled="working || busy"><option value="omit">Use provider default</option><option value="false">Off</option><option value="true">On</option></select></label>
          </details>
          <p class="provider-help">Selected content is sent to this provider when you chat. Remote services may charge for usage. Your key is saved on this computer.</p>
        </div>

        <footer><button type="button" :disabled="working || busy || !configuration || dirty" @click="runOperation('test')">{{ operation === 'test' ? 'Testing…' : 'Test connection' }}</button><button class="provider-save" :disabled="working || busy || !configuration">{{ operation === 'save' ? 'Saving…' : 'Save settings' }}</button></footer>
        <p class="provider-footnote">{{ dirty ? "Save changes before testing. " : "" }}The test sends only a generated blue square.</p>
      </form>
    </dialog>
  </Teleport>
</template>
<script setup>
import { inject, ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { CHAT_CONTEXT } from '../context/renderer-contexts';
import ChatIcon from './ChatIcon.vue';
const { settings, configuration, working, busy, error, notice, saveConfiguration, testConnection } = inject(CHAT_CONTEXT);
const dialog = ref(null);
const banner = ref(null);
const operation = ref('');
let bannerTimer;
watch([banner, operation], ([value, active]) => {
  clearTimeout(bannerTimer);
  if (value && !active) bannerTimer = setTimeout(() => { banner.value = null; }, 10000);
});
let mounted = true;
watch(error, value => { if (value) banner.value = { kind: 'error', text: value }; }, { immediate: true });
function toggleKeyRemoval() {
  configuration.value.clearKey = !configuration.value.clearKey;
  banner.value = { kind: 'info', text: configuration.value.clearKey
    ? 'Save settings to remove the local key copy. This does not revoke your provider key.'
    : 'Key removal cancelled.' };
}
async function runOperation(kind) {
  if (working.value || busy.value || (kind === 'test' && dirty.value)) return;
  operation.value = kind;
  banner.value = { kind: 'info', text: kind === 'test' ? 'Testing connection…' : 'Saving settings…' };
  try {
    await (kind === 'test' ? testConnection() : saveConfiguration());
    if (!mounted) return;
    banner.value = error.value
      ? { kind: 'error', text: (kind === 'test' ? 'Connection failed. ' : 'Could not save settings. ') + error.value }
      : { kind: 'success', text: kind === 'test' ? 'Connection successful. The provider responded to the test image.' : 'Settings saved.' };
    notice.value = '';
  } catch {
    if (mounted) banner.value = { kind: 'error', text: 'The operation could not be completed. Please try again.' };
  } finally { if (mounted) operation.value = ''; }
}
const saved = ref('');
watch(configuration, value => { saved.value = JSON.stringify(value); }, { immediate: true });
const dirty = computed(() => JSON.stringify(configuration.value) !== saved.value);
onMounted(() => dialog.value.showModal());
onBeforeUnmount(() => { mounted = false; clearTimeout(bannerTimer); dialog.value?.close(); if (configuration.value) configuration.value.apiKey = ''; });
</script>
