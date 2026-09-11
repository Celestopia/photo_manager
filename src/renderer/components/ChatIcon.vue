<template>
  <svg class="chat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.chat" /></svg>
</template>
<script setup>
defineProps({ name: { type: String, default: 'chat' } });
const paths = {
  copy: 'M9 8h11v13H9zM15 4V2H3v14h2',
  check: 'm5 12 4 4L19 6',
  gear: 'M9.206 5.256 L10.482 4.860 L10.436 2.123 L13.564 2.123 L13.518 4.860 L14.794 5.256 L15.976 5.878 L17.878 3.910 L20.090 6.122 L18.122 8.024 L18.744 9.206 L19.140 10.482 L21.877 10.436 L21.877 13.564 L19.140 13.518 L18.744 14.794 L18.122 15.976 L20.090 17.878 L17.878 20.090 L15.976 18.122 L14.794 18.744 L13.518 19.140 L13.564 21.877 L10.436 21.877 L10.482 19.140 L9.206 18.744 L8.024 18.122 L6.122 20.090 L3.910 17.878 L5.878 15.976 L5.256 14.794 L4.860 13.518 L2.123 13.564 L2.123 10.436 L4.860 10.482 L5.256 9.206 L5.878 8.024 L3.910 6.122 L6.122 3.910 L8.024 5.878 Z M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0',
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
