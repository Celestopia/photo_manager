<template>
  <label :for="id + '-name'">Location name</label><input :id="id + '-name'" class="input" v-model="name" :disabled="disabled" :autofocus="editing" @keydown="onNameKey" />
  <label :for="id + '-country'">Country</label><input :id="id + '-country'" class="input" v-model="country" :disabled="disabled" />
  <label :for="id + '-province'">State/Province</label><input :id="id + '-province'" class="input" v-model="province" :disabled="disabled" />
  <label :for="id + '-city'">City</label><input :id="id + '-city'" class="input" v-model="city" :disabled="disabled" />
  <label>Parent location</label>
  <LocationParentPicker :class="{ 'location-manager-parent-control': editing }" :model-value="parentId || ''" :exclude-id="excludeId" :placeholder="editing ? 'No parent' : 'Select a parent location (optional)'" :disabled="disabled" @update:model-value="emit('update:parentId', $event)" />
  <label :for="id + '-description'">Description (optional)</label><textarea :id="id + '-description'" class="input" :class="editing ? 'tag-manager-description-input' : 'tag-create-description location-create-description'" v-model="description" :disabled="disabled" :placeholder="editing ? 'Optional' : undefined" @keydown="onDescriptionKey"></textarea>
</template>
<script setup>
import { useId } from 'vue';
import LocationParentPicker from './LocationParentPicker.vue';
const props = defineProps({ disabled: Boolean, editing: Boolean, parentId: String, excludeId: String });
const name = defineModel('name'), country = defineModel('country'), province = defineModel('province'), city = defineModel('city'), description = defineModel('description');
const emit = defineEmits(['update:parentId', 'save', 'cancel']);
const id = useId();
function onNameKey(event) {
  if (!props.editing || event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter' && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) { event.preventDefault(); emit('save'); }
  if (event.key === 'Escape') { event.preventDefault(); emit('cancel'); }
}
function onDescriptionKey(event) {
  if (props.editing && event.ctrlKey && event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); emit('save'); }
}
</script>
