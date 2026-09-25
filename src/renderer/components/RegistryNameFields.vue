<template>
  <label :for="nameId">{{ label }}</label>
  <input :id="nameId" class="input" v-model="name" :disabled="disabled" :autofocus="editing" @keydown="onNameKey" />
  <label :for="descriptionId">{{ requiredDescription ? 'Description' : 'Description (optional)' }}</label>
  <textarea :id="descriptionId" class="input" :class="editing ? 'tag-manager-description-input' : 'tag-create-description'" v-model="description" :disabled="disabled" :placeholder="editing && !requiredDescription ? 'Optional' : undefined" @keydown="onDescriptionKey"></textarea>
</template>
<script setup>
import { useId } from 'vue';
const props = defineProps({ label: String, disabled: Boolean, editing: Boolean, requiredDescription: Boolean });
const name = defineModel('name'), description = defineModel('description');
const emit = defineEmits(['save', 'cancel']);
const nameId = useId(), descriptionId = useId();
function onNameKey(event) {
  if (!props.editing || event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter' && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) { event.preventDefault(); emit('save'); }
  if (event.key === 'Escape') { event.preventDefault(); emit('cancel'); }
}
function onDescriptionKey(event) {
  if (props.editing && event.ctrlKey && event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); emit('save'); }
}
</script>
