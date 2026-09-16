<template>
  <svg class="registry-field-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <template v-if="kind === 'album'"><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 3v18M12 8h4" /></template>
    <template v-else-if="kind === 'location'"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></template>
    <template v-else-if="kind === 'people'"><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2Z" /></template>
    <path v-else d="m3 3 9 .1 9 9-9 9-9-9V3Zm4 4h.01" />
  </svg>
</template>

<script setup>
defineProps({ kind: { type: String, required: true } });
</script>
