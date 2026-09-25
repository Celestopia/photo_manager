<template>
  <Teleport to="body">
    <dialog ref="element" v-bind="$attrs" class="app-dialog" :class="`app-dialog-${size}`" :aria-labelledby="headingId" @cancel.prevent="cancel" @keydown.stop @keydown.esc.prevent="cancel" @click="backdrop">
      <header class="app-dialog-header">
        <slot name="header"><h3>{{ title }}</h3><button v-if="closable" type="button" class="btn icon-btn modal-symbol-btn" aria-label="Close dialog" data-tip="Close" :disabled="busy" @click="requestClose">×</button></slot>
      </header>
      <slot />
      <footer v-if="$slots.footer" class="app-dialog-actions"><slot name="footer" /></footer>
    </dialog>
  </Teleport>
</template>
<script setup>
import { onMounted, onBeforeUnmount, ref, useId } from 'vue';
defineOptions({ inheritAttrs: false });
const props = defineProps({ title: String, size: { type: String, default: 'medium' }, busy: Boolean, closable: { type: Boolean, default: true }, dismissOnEscape: Boolean, dismissOnBackdrop: Boolean, initialFocus: String });
const emit = defineEmits(['close', 'opened']);
const element = ref(null), headingId = `dialog-${useId()}`;
let opener;
function requestClose() { if (!props.busy) emit('close'); }
function cancel() { if (props.dismissOnEscape) requestClose(); }
function backdrop(event) {
  if (!props.dismissOnBackdrop || event.target !== element.value) return;
  const r = element.value.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) requestClose();
}
onMounted(() => {
  opener = document.activeElement;
  const heading = element.value.querySelector('.app-dialog-header h3, .app-dialog-header h2');
  if (heading) heading.id = headingId;
  element.value.showModal();
  if (props.initialFocus) element.value.querySelector(props.initialFocus)?.focus();
  emit('opened');
});
onBeforeUnmount(() => { element.value?.close(); if (opener?.isConnected) opener.focus(); });
</script>
