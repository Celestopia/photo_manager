<template>
  <div class="registry-filter-picker" @click.stop>
    <button type="button" class="input registry-trigger" @click="toggleDropdown">
      <span>{{ selectedLabel }}</span>
      <img class="registry-trigger-arrow" :src="ICONS.chevronDown" alt="" />
    </button>
    <RegistryOptionsMenu
      v-if="dropdownOpen"
      class="registry-filter-dropdown"
      :search-text="searchText"
      :search-placeholder="`Search ${label.toLowerCase()}`"
      :options="filteredOptions"
      :fixed-options="fixedOptions"
      :selected-values="[selectedValue]"
      :id-key="optionIdKey"
      :label-key="optionLabelKey"
      :show-all-section-label="false"
      :empty-text="`No matching ${label.toLowerCase()}`"
      @update:search-text="searchText = $event"
      @select="selectValue"
      @close="closeDropdown"
    />
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { GALLERY_FILTER_CONTEXT } from "../context/renderer-contexts.js";
import RegistryOptionsMenu from "./RegistryOptionsMenu.vue";

const props = defineProps({
  kind: { type: String, required: true },
  label: { type: String, required: true },
});

const app = inject(GALLERY_FILTER_CONTEXT);
if (!app) throw new Error("RegistryFilterPicker must be used under App.vue provider");

const {
  ICONS,
  query,
  filterOptions,
  UNASSIGNED_FILTER,
  applyFilterSort,
} = app;

const dropdownOpen = ref(false);
const pickerId = Symbol(props.kind);
const searchText = ref("");
const selectedValue = computed(() => query.filters[props.kind] || "");
const unassignedLabel = computed(() => `Unassigned ${props.label}`);
const fixedOptions = computed(() => [
  { value: "", label: "All" },
  { value: UNASSIGNED_FILTER, label: unassignedLabel.value },
]);
const optionIdKey = computed(() => {
  if (props.kind === "album") return "AlbumId";
  if (props.kind === "tag") return "TagId";
  return "PersonId";
});
const optionLabelKey = computed(() => {
  if (props.kind === "album") return "Title";
  if (props.kind === "tag") return "Text";
  return "Name";
});
const selectedLabel = computed(() => {
  if (!selectedValue.value) return "All";
  if (selectedValue.value === UNASSIGNED_FILTER) return unassignedLabel.value;
  return optionLabel(options.value.find((option) => optionId(option) === selectedValue.value)) || "All";
});
const options = computed(() => filterOptions[props.kind === "person" ? "people" : `${props.kind}s`] || []);
const normalizedSearch = computed(() => searchText.value.trim().toLocaleLowerCase("en-US"));
const filteredOptions = computed(() => options.value.filter((option) => matches(`${optionLabel(option)} ${option?.Description || ""}`)));

function matches(value) {
  return !normalizedSearch.value || String(value).toLocaleLowerCase("en-US").includes(normalizedSearch.value);
}

function optionId(option) {
  if (props.kind === "album") return option?.AlbumId || "";
  if (props.kind === "tag") return option?.TagId || "";
  return option?.PersonId || "";
}

function optionLabel(option) {
  if (props.kind === "album") return option?.Title || "";
  if (props.kind === "tag") return option?.Text || "";
  return option?.Name || "";
}

function closeDropdown() {
  dropdownOpen.value = false;
  searchText.value = "";
}

function toggleDropdown() {
  const nextOpen = !dropdownOpen.value;
  if (nextOpen) {
    window.dispatchEvent(new CustomEvent("gallery-transient-open", { detail: pickerId }));
  }
  dropdownOpen.value = nextOpen;
}

function closeFromOtherSurface(event) {
  if (event.detail !== pickerId) closeDropdown();
}

async function selectValue(value) {
  query.filters[props.kind] = value;
  closeDropdown();
  await applyFilterSort();
}

onMounted(() => {
  window.addEventListener("click", closeDropdown);
  window.addEventListener("gallery-transient-open", closeFromOtherSurface);
});

onBeforeUnmount(() => {
  window.removeEventListener("click", closeDropdown);
  window.removeEventListener("gallery-transient-open", closeFromOtherSurface);
});
</script>
