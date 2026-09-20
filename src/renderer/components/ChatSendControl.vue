<template>
  <button v-if="busy" class="btn btn-primary" title="Stop response" aria-label="Stop response" @click="$emit('stop')"><ChatIcon name="stop" /></button>
  <button v-else class="btn btn-primary" title="Send message" aria-label="Send message" :disabled="disabled" @click="$emit('send')"><ChatIcon name="send" /></button>
</template>
<script setup>
import ChatIcon from './ChatIcon.vue';
defineProps({busy:Boolean,disabled:Boolean});defineEmits(['send','stop']);
</script>
