<template>
  <div class="copy-toast" v-if="toast.visible">{{ toast.message }}</div>
  <div
    class="dynamic-tooltip"
    v-if="dynamicTooltip.visible"
    ref="dynamicTooltipRef"
    :style="{ left: dynamicTooltip.x + 'px', top: dynamicTooltip.y + 'px' }"
  >{{ dynamicTooltip.text }}</div>
</template>

<script setup>
import { inject } from "vue";
import { UI_FEEDBACK_CONTEXT } from "../../context/renderer-contexts.js";

const context = inject(UI_FEEDBACK_CONTEXT);
if (!context) throw new Error("UiFeedbackOverlay requires UI_FEEDBACK_CONTEXT");
const { toast, dynamicTooltip, dynamicTooltipRef } = context;
</script>
