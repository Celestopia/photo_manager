<template>
  <div class="location-filter-picker" @click.stop>
    <div class="album-input-wrap">
      <button
        type="button"
        class="input location-filter-input registry-trigger"
        :data-tip="selectionTooltip"
        @click="openDropdown"
      ><span>{{ selectedFilterLabel || 'All' }}</span><img class="registry-trigger-arrow" :src="ICONS.chevronDown" alt="" /></button>
      <LocationTreeMenu
        v-if="dropdownOpen"
        class="location-filter-dropdown"
        :rows="filterRows"
        :search-text="searchText"
        :selected-location-ids="selectedLocationIds"
        :selected-regions="selectedRegions"
        :all-selected="!selectedLocationIds.length && !selectedRegions.length"
        :unassigned-selected="selectedLocationIds.includes(UNASSIGNED_FILTER)"
        show-all-option
        show-unassigned-option
        show-fixed-options-divider
        mode="filter"
        search-placeholder="Search locations"
        @update:search-text="searchText = $event"
        @select-location="selectLocation"
        @select-region="selectRegion"
        @select-all="selectLocation('', $event)"
        @select-unassigned="selectLocation(UNASSIGNED_FILTER, $event)"
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
  UNASSIGNED_FILTER,
  query,
  getLocationFilterRows,
  getLocationName,
  setLocationFilter,
  setLocationRegionFilter,
} = app;

const dropdownOpen = ref(false);
const pickerId = Symbol("location");
const searchText = ref("");
const selectedLocationIds = computed(() => query.filters.location);
const selectedRegions = computed(() => query.filters.locationRegion);
const selectionLabels = computed(() => [
  ...selectedLocationIds.value.map(id => id === UNASSIGNED_FILTER ? 'Unassigned' : getLocationName(id)),
  ...selectedRegions.value.map(getLocationRegionFilterLabel),
]);
const selectionTooltip = computed(() => selectionLabels.value.length > 1 ? selectionLabels.value.join(', ') : 'Ctrl+Click to select multiple');
const selectedFilterLabel = computed(() => !selectionLabels.value.length ? 'All' : selectionLabels.value[0] + (selectionLabels.value.length > 1 ? ` +${selectionLabels.value.length - 1}` : ''));
const filterRows = computed(() => getLocationFilterRows(searchText.value));

function openDropdown() {
  const nextOpen = !dropdownOpen.value;
  if (!nextOpen) {
    closeDropdown();
    return;
  }
  window.dispatchEvent(new CustomEvent("gallery-transient-open", { detail: pickerId }));
  dropdownOpen.value = true;
}

function closeFromOtherSurface(event) {
  if (event.detail !== pickerId) closeDropdown();
}

function closeDropdown() {
  dropdownOpen.value = false;
  searchText.value = "";
}

async function selectLocation(name, event) {
  if (!event?.ctrlKey || !name) closeDropdown();
  await setLocationFilter(name, Boolean(event?.ctrlKey));
}

async function selectRegion(region, event) {
  if (!event?.ctrlKey) closeDropdown();
  await setLocationRegionFilter(region, Boolean(event?.ctrlKey));
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
