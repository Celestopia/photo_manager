<template>
  <div class="location-filter-picker" @click.stop>
    <div class="album-input-wrap">
      <input
        class="input location-filter-input"
        v-model="filterInputText"
        :data-tip="selectedLocation ? getLocationTooltip(selectedLocation) : ''"
        @focus="openDropdown"
        @input="openDropdown"
        @keydown="onKeydown"
        autocomplete="off"
        placeholder="全部"
      />
      <button
        type="button"
        class="album-clear-btn"
        v-if="selectedLocation"
        data-tip="清除地点筛选"
        aria-label="清除地点筛选"
        @click.stop="clearFilter"
      >×</button>
      <div class="tag-dropdown location-dropdown location-filter-dropdown" v-if="dropdownOpen">
        <div class="location-dropdown-current-context" v-if="filterDropdownContext">{{ filterDropdownContext }}</div>
        <div class="location-dropdown-scroll" ref="filterDropdownRef" @scroll="updateFilterDropdownContext">
          <button type="button" class="tag-option location-option" @mousedown.prevent="selectLocation('')">
            <span>全部</span>
          </button>
          <template v-for="row in filterRows" :key="'filter_' + row.Key">
            <div v-if="row.Type === 'section'" class="location-section-label">{{ row.Label }}</div>
            <button
              v-else-if="row.Location"
              type="button"
              class="tag-option location-option"
              :class="{ 'location-group-selectable': row.Type === 'group' }"
              :data-tip="getLocationTooltip(row.Location.Name)"
              :data-location-context="getLocationManagerRowContext(row)"
              :data-location-recent="row.Key.startsWith('filter-recent-location:') ? '1' : null"
              :style="{ paddingLeft: 16 + row.Depth * 16 + 'px' }"
              @mousedown.prevent="selectLocation(row.Location.Name)"
            >
              <span>{{ row.Label }}</span>
            </button>
            <div
              v-else
              class="location-group-row"
              :style="{ paddingLeft: 16 + row.Depth * 16 + 'px' }"
            >{{ row.Label }}</div>
          </template>
          <div class="tag-option-empty" v-if="!filterRows.length">没有匹配的地点</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, nextTick, ref, watch } from "vue";

const app = inject("appContext");
if (!app) {
  throw new Error("LocationFilterPicker must be used under App.vue provider");
}

const {
  query,
  getLocationFilterRows,
  getLocationTooltip,
  getLocationManagerRowContext,
  setLocationFilter,
} = app;

const dropdownOpen = ref(false);
const searchText = ref("");
const filterDropdownRef = ref(null);
const filterDropdownContext = ref("");
const selectedLocation = computed(() => query.filters.location || "");
const filterInputText = computed({
  get() {
    return dropdownOpen.value ? searchText.value : selectedLocation.value || "全部";
  },
  set(value) {
    searchText.value = value;
  },
});
const filterRows = computed(() => getLocationFilterRows(searchText.value));

function openDropdown() {
  dropdownOpen.value = true;
}

function closeDropdown() {
  dropdownOpen.value = false;
  searchText.value = "";
  filterDropdownContext.value = "";
}

async function selectLocation(name) {
  await setLocationFilter(name);
  closeDropdown();
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

function firstSelectableRow() {
  return filterRows.value.find((row) => row.Location);
}

async function onKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    const first = firstSelectableRow();
    if (first) await selectLocation(first.Location.Name);
    return;
  }
  if (event.key === "Escape") {
    closeDropdown();
  }
}
</script>