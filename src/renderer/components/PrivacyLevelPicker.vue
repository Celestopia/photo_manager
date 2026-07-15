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
      :aria-label="'隐私等级 ' + level"
      :data-tip="'隐私等级 ' + level"
      @click="$emit('update:modelValue', level)"
    >
      <img class="privacy-level-icon" :src="ICONS.privacyPattern" alt="" />
    </button>
  </div>
</template>

<script setup>
import { ICONS, PRIVACY_LEVELS } from "../constants/ui-constants.mjs";

defineProps({
  modelValue: { type: Number, default: null },
  ariaLabel: { type: String, default: "隐私等级" },
});

defineEmits(["update:modelValue"]);
</script>
