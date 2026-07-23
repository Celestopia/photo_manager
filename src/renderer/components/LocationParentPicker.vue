<template>
  <div ref="rootRef" class="album-input-wrap location-parent-picker" @click.stop>
    <button
      type="button"
      class="input registry-trigger location-parent-trigger"
      :disabled="disabled"
      @click="toggleDropdown"
    ><span>{{ getLocationName(modelValue) || placeholder }}</span></button>
    <button
      v-if="modelValue"
      type="button"
      class="album-clear-btn"
      data-tip="清空父节点"
      aria-label="清空父节点"
      :disabled="disabled"
      @click.stop="selectParent('')"
    >×</button>
    <LocationTreeMenu
      v-if="dropdownOpen"
      :rows="parentRows"
      :search-text="searchText"
      :selected-location-id="modelValue || ''"
      mode="parent"
      search-placeholder="搜索父地点"
      empty-text="没有匹配的父地点"
      @update:search-text="searchText = $event"
      @select-location="selectParent"
      @close="closeDropdown"
    />
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { LOCATION_CONTEXT } from "../context/renderer-contexts.js";
import LocationTreeMenu from "./LocationTreeMenu.vue";

const props = defineProps({
  modelValue: { type: String, default: "" },
  excludeId: { type: String, default: "" },
  placeholder: { type: String, default: "选择父地点，可留空" },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue"]);

const app = inject(LOCATION_CONTEXT);
if (!app) throw new Error("LocationParentPicker requires LOCATION_CONTEXT");
const { getLocationName, getLocationParentRows } = app;

const dropdownOpen = ref(false);
const searchText = ref("");
const rootRef = ref(null);
const pickerId = Symbol("location-parent-picker");
const parentRows = computed(() => getLocationParentRows(searchText.value, props.excludeId));

function toggleDropdown() {
  if (props.disabled) return;
  if (dropdownOpen.value) {
    closeDropdown();
    return;
  }
  window.dispatchEvent(new CustomEvent("gallery-transient-open", { detail: pickerId }));
  dropdownOpen.value = true;
}

function closeDropdown() {
  dropdownOpen.value = false;
  searchText.value = "";
}

function closeFromOtherSurface(event) {
  if (event.detail !== pickerId) closeDropdown();
}

function closeFromOutsidePointer(event) {
  if (dropdownOpen.value && !rootRef.value?.contains(event.target)) closeDropdown();
}

function selectParent(locationId) {
  emit("update:modelValue", locationId || null);
  closeDropdown();
}

onMounted(() => {
  document.addEventListener("pointerdown", closeFromOutsidePointer, true);
  window.addEventListener("gallery-transient-open", closeFromOtherSurface);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeFromOutsidePointer, true);
  window.removeEventListener("gallery-transient-open", closeFromOtherSurface);
});
</script>
