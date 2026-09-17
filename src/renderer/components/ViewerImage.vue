<template>
  <img v-if="src" :key="src" class="viewer-image" :src="src" :alt="alt" draggable="false"
    :style="[mediaStyle, { visibility: ready ? 'visible' : 'hidden' }]" @load="loaded" @error="failed" />
</template>

<script setup>
import { ref, watch } from "vue";
const props = defineProps({ src: { type: String, default: "" }, alt: { type: String, default: "" }, mediaStyle: Object });
const emit = defineEmits(["loaded", "failed"]);
const ready = ref(false);
watch(() => props.src, () => { ready.value = false; }, { flush: "sync" });
function loaded(event) {
  if (event.currentTarget.getAttribute("src") !== props.src) return;
  ready.value = true;
  emit("loaded", props.src);
}
function failed(event) {
  if (event.currentTarget.getAttribute("src") !== props.src) return;
  ready.value = false;
  emit("failed", props.src);
}
</script>
