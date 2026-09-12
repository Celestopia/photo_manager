<template>
  <span class="usage-anchor">
    <button class="chat-message-copy" :aria-label="label" :title="label" :aria-expanded="open" @click.stop="toggle"><svg class="chat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 6v8m0 3v1"/></svg></button>
    <Teleport to="body"><div v-if="open" ref="menu" class="usage-menu" :style="position" role="dialog" :aria-label="label" @click.stop><strong>{{ label }}</strong><dl><div v-for="[key, name] in usageFields" :key="key"><dt>{{ name }}</dt><dd>{{ usage?.[key] == null ? 'Not reported' : usage[key].toLocaleString('en-US') }}</dd></div></dl><small v-if="incomplete">Totals are incomplete: some usage was not reported.</small></div></Teleport>
  </span>
</template>
<script setup>
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { usageFields } from '../domain/chat-usage.mjs';
defineProps({ usage: Object, incomplete: Boolean, label: { type: String, default: 'Token usage' } });
const open = ref(false), menu = ref(null), position = ref({});
function close() { open.value = false; }
function key(event) { if (event.key === 'Escape') close(); }
async function toggle(event) {
  if (open.value) return close();
  window.dispatchEvent(new Event('close-token-usage'));
  const r = event.currentTarget.getBoundingClientRect();
  open.value = true; await nextTick();
  const box = menu.value.getBoundingClientRect();
  position.value = { left: Math.max(8, Math.min(r.left, innerWidth-box.width-8))+'px', top: Math.max(8, Math.min(r.bottom+6, innerHeight-box.height-8))+'px' };
}
onMounted(() => { window.addEventListener('click', close); window.addEventListener('keydown', key, true); window.addEventListener('close-token-usage', close); window.addEventListener('resize', close); });
onBeforeUnmount(() => { window.removeEventListener('click', close); window.removeEventListener('keydown', key, true); window.removeEventListener('close-token-usage', close); window.removeEventListener('resize', close); });
</script>
