<template>
  <svg class="chat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.chat" /></svg>
</template>
<script setup>
defineProps({ name: { type: String, default: 'chat' } });
const paths = {
  plus: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  history: 'M3 11a9 9 0 1 1 2.6 7M3 5v6h6M12 7v5l3 2',
  options: 'M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6',
  send: 'M12 19V5m-6 6 6-6 6 6',
  stop: 'M7 7h10v10H7z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  file: 'M14 3H6v18h12V7zM14 3v5h4M9 13h6M9 17h4',
  info: 'M12 11v6M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  chat: 'M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0ZM7 10h8M7 14h5',
};
</script>
