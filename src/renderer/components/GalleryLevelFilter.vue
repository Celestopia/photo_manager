<template>
  <div class="gallery-level-filter">
    <span class="gallery-filter-label">{{ label }}</span>
    <div class="segmented-filter" role="group" :aria-label="label">
      <button
        type="button"
        :class="{ active: selectedLevels.length === 0 }"
        :aria-pressed="selectedLevels.length === 0"
        @click="$emit('select-all')"
      >全部</button>
      <button
        v-for="level in levels"
        :key="level"
        type="button"
        :class="{ active: selectedLevels.includes(level) }"
        :aria-pressed="selectedLevels.includes(level)"
        @click="$emit('toggle-level', level)"
      >{{ level }}</button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  levels: { type: Array, required: true },
  selectedLevels: { type: Array, required: true },
});

defineEmits(["select-all", "toggle-level"]);
</script>
