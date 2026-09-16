<template>
  <div class="privacy-levels" role="radiogroup" :aria-label="ariaLabel">
    <button
      v-for="level in PRIVACY_LEVELS"
      :key="'privacy_level_' + level"
      type="button"
      role="radio"
      class="privacy-level-btn"
      :class="{ active: modelValue != null && level <= modelValue }"
      :aria-checked="modelValue === level"
      :aria-label="'Privacy level ' + level"
      :data-tip="'Privacy level ' + level"
      @click="$emit('update:modelValue', level)"
    >
      <svg class="privacy-level-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="1.8" /><rect x="4" y="9" width="16" height="13" rx="3" fill="currentColor" /><path d="M12 14v3" stroke="white" stroke-width="1.8" stroke-linecap="round" /></svg>
    </button>
  </div>
</template>

<script setup>
import { PRIVACY_LEVELS } from "../constants/ui-constants.mjs";

defineProps({
  modelValue: { type: Number, default: null },
  ariaLabel: { type: String, default: "Privacy level" },
});

defineEmits(["update:modelValue"]);
</script>
