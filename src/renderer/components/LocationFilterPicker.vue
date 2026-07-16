<template>
  <div class="location-filter-picker" @click.stop>
    <div class="album-input-wrap">
      <button
        type="button"
        class="input location-filter-input registry-trigger"
        :data-tip="selectedLocationId ? getLocationTooltip(selectedLocationId) : selectedRegionLabel"
        @click="openDropdown"
      ><span>{{ selectedFilterLabel || '全部' }}</span><img class="registry-trigger-arrow" :src="ICONS.chevronDown" alt="" /></button>
      <div class="tag-dropdown location-dropdown location-filter-dropdown" v-if="dropdownOpen">
        <input
          ref="searchInputRef"
          class="input dropdown-search-input location-dropdown-search"
          v-model="searchText"
          placeholder="搜索地点"
          @keydown="onKeydown"
        />
        <div class="location-dropdown-current-context" v-if="filterDropdownContext">{{ filterDropdownContext }}</div>
        <div class="location-dropdown-scroll" ref="filterDropdownRef" @scroll="updateFilterDropdownContext">
          <button type="button" class="tag-option location-option" :class="{ 'is-selected': selectedLocationId === '' && !selectedLocationRegion }" @mousedown.prevent="selectLocation('')">
            <span>全部</span>
          </button>
          <template v-for="row in filterRows" :key="'filter_' + row.Key">
            <div
              v-if="row.Type === 'section'"
              class="location-section-label"
              :class="{ 'registry-section-divider': row.Key.includes('section:all') }"
            ><span>{{ row.Label }}</span></div>
            <button
              v-else-if="row.Type === 'group'"
              type="button"
              class="tag-option location-option location-group-selectable"
              :class="{ 'is-selected': isSelectedRegion(row.Region) }"
              :data-tip="`筛选 ${regionLabel(row.Region)} 下的全部地点`"
              :data-location-context="getLocationManagerRowContext(row)"
              :style="{ paddingLeft: 8 + row.Depth * 16 + 'px' }"
              @mousedown.prevent="selectRegion(row.Region)"
            >
              <span>{{ row.Label }}</span>
            </button>
            <button
              v-else-if="row.Location"
              type="button"
              class="tag-option location-option"
              :class="{ 'is-selected': selectedLocationId === row.Location.LocationId }"
              :data-tip="getLocationTooltip(row.Location.LocationId)"
              :data-location-context="getLocationManagerRowContext(row)"
              :data-location-recent="row.Key.startsWith('filter-recent-location:') ? '1' : null"
              :style="{ paddingLeft: 8 + row.Depth * 16 + 'px' }"
              @mousedown.prevent="selectLocation(row.Location.LocationId)"
            >
              <span>{{ row.Label }}</span>
            </button>
          </template>
          <div class="tag-option-empty" v-if="!filterRows.length">没有匹配的地点</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { LOCATION_CONTEXT } from "../context/renderer-contexts.js";
import { getLocationRegionFilterLabel, sameLocationRegionFilter } from "../domain/location-hierarchy.mjs";

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
  getLocationManagerRowContext,
  setLocationFilter,
  setLocationRegionFilter,
} = app;

const dropdownOpen = ref(false);
const pickerId = Symbol("location");
const searchText = ref("");
const filterDropdownRef = ref(null);
const searchInputRef = ref(null);
const filterDropdownContext = ref("");
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
  nextTick(() => searchInputRef.value?.focus());
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
  filterDropdownContext.value = "";
}

async function selectLocation(name) {
  closeDropdown();
  await setLocationFilter(name);
}

async function selectRegion(region) {
  closeDropdown();
  await setLocationRegionFilter(region);
}

function regionLabel(region) {
  return getLocationRegionFilterLabel(region);
}

function isSelectedRegion(region) {
  return Boolean(selectedLocationRegion.value && sameLocationRegionFilter(selectedLocationRegion.value, region));
}

async function clearFilter() {
  await selectLocation("");
}

function updateFilterDropdownContext() {
  const list = filterDropdownRef.value;
  if (!list) {
    filterDropdownContext.value = "";
    return;
  }
  const listTop = list.getBoundingClientRect().top;
  const items = [...list.querySelectorAll(".location-option[data-location-context]")];
  let current = null;
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    if (rect.top <= listTop + 1 && rect.bottom > listTop) current = item;
    else if (!current && rect.top > listTop) {
      current = item;
      break;
    }
  }
  filterDropdownContext.value = current?.dataset?.locationRecent === "1" ? "" : current?.dataset?.locationContext || "";
}

function scheduleFilterDropdownContextUpdate() {
  if (!dropdownOpen.value) {
    filterDropdownContext.value = "";
    return;
  }
  nextTick(() => updateFilterDropdownContext());
}

watch(
  () => [dropdownOpen.value, filterRows.value.length, searchText.value],
  () => scheduleFilterDropdownContextUpdate()
);

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

function firstSelectableRow() {
  return filterRows.value.find((row) => row.Type === "group" || row.Location);
}

async function onKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    const first = firstSelectableRow();
    if (first?.Type === "group") await selectRegion(first.Region);
    else if (first?.Location) await selectLocation(first.Location.LocationId);
    return;
  }
  if (event.key === "Escape") {
    closeDropdown();
  }
}
</script>
