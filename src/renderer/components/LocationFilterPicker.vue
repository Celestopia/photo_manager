<template>
  <div class="location-filter-picker" @click.stop>
    <div class="album-input-wrap">
      <button
        type="button"
        class="input location-filter-input registry-trigger"
        :data-tip="selectedLocationId ? getLocationTooltip(selectedLocationId) : selectedRegionLabel"
        @click="openDropdown"
      ><span>{{ selectedFilterLabel || '全部' }}</span><img class="registry-trigger-arrow" :src="ICONS.chevronDown" alt="" /></button>
      <LocationTreeMenu
        v-if="dropdownOpen"
        class="location-filter-dropdown"
        :rows="filterRows"
        :search-text="searchText"
        :selected-location-id="selectedLocationId"
        :selected-region="selectedLocationRegion"
        :all-selected="selectedLocationId === '' && !selectedLocationRegion"
        show-all-option
        mode="filter"
        search-placeholder="搜索地点"
        @update:search-text="searchText = $event"
        @select-location="selectLocation"
        @select-region="selectRegion"
        @select-all="selectLocation('')"
        @close="closeDropdown"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { LOCATION_CONTEXT } from "../context/renderer-contexts.js";
import { getLocationRegionFilterLabel } from "../domain/location-hierarchy.mjs";
import LocationTreeMenu from "./LocationTreeMenu.vue";

const app = inject(LOCATION_CONTEXT);
if (!app) {
  throw new Error("LocationFilterPicker must be used under App.vue provider");
}

const {
  ICONS,
  query,
  getLocationFilterRows,
  getLocationTooltip,
  getLocationName,
  setLocationFilter,
  setLocationRegionFilter,
} = app;

const dropdownOpen = ref(false);
const pickerId = Symbol("location");
const searchText = ref("");
const selectedLocationId = computed(() => query.filters.location || "");
const selectedLocationRegion = computed(() => query.filters.locationRegion || null);
const selectedLocationName = computed(() => getLocationName(selectedLocationId.value));
const selectedRegionLabel = computed(() => getLocationRegionFilterLabel(selectedLocationRegion.value));
const selectedFilterLabel = computed(() => selectedLocationName.value || selectedRegionLabel.value);
const filterRows = computed(() => getLocationFilterRows(searchText.value));

function openDropdown() {
  const nextOpen = !dropdownOpen.value;
  if (!nextOpen) {
    closeDropdown();
    return;
  }
  window.dispatchEvent(new CustomEvent("gallery-filter-picker-open", { detail: pickerId }));
  window.dispatchEvent(new CustomEvent("gallery-transient-open", { detail: pickerId }));
  dropdownOpen.value = true;
}

function closeFromOtherPicker(event) {
  if (event.detail !== pickerId) closeDropdown();
}

function closeFromOtherSurface(event) {
  if (event.detail !== pickerId) closeDropdown();
}

function closeDropdown() {
  dropdownOpen.value = false;
  searchText.value = "";
}

async function selectLocation(name) {
  closeDropdown();
  await setLocationFilter(name);
}

async function selectRegion(region) {
  closeDropdown();
  await setLocationRegionFilter(region);
}

onMounted(() => {
  window.addEventListener("click", closeDropdown);
  window.addEventListener("gallery-filter-picker-open", closeFromOtherPicker);
  window.addEventListener("gallery-transient-open", closeFromOtherSurface);
});

onBeforeUnmount(() => {
  window.removeEventListener("click", closeDropdown);
  window.removeEventListener("gallery-filter-picker-open", closeFromOtherPicker);
  window.removeEventListener("gallery-transient-open", closeFromOtherSurface);
});

</script>
