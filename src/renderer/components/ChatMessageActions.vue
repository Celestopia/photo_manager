<template>
  <div class="chat-message-actions">
    <button v-if="message.text" class="chat-message-copy" :title="copied ? 'Copied' : 'Copy message'" :aria-label="copied ? 'Copied' : 'Copy message'" @click="$emit('copy',message)"><ChatIcon :name="copied ? 'check' : 'copy'" /></button>
    <TokenUsage v-if="message.role === 'assistant'" :usage="messageUsage(message).usage" :incomplete="messageUsage(message).incomplete" />
  </div>
</template>
<script setup>
import ChatIcon from './ChatIcon.vue';
import TokenUsage from './TokenUsage.vue';
import { messageUsage } from '../domain/chat-usage.mjs';
defineProps({message:Object,copied:Boolean});
defineEmits(['copy']);
</script>
