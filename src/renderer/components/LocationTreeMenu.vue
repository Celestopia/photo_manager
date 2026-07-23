<template>
  <div class="tag-dropdown location-dropdown selection-dropdown location-tree-menu" @click.stop>
    <input
      ref="searchInputRef"
      class="input dropdown-search-input location-dropdown-search"
      :value="searchText"
      :placeholder="searchPlaceholder"
      autocomplete="off"
      @input="updateSearch"
      @keydown="onSearchKeydown"
    />
    <div class="location-dropdown-scroll">
      <button
        v-if="showAllOption"
        type="button"
        class="tag-option location-option location-tree-all-option"
        :class="{ 'is-selected': allSelected }"
        @mousedown.prevent="emit('select-all')"
      ><span>全部</span></button>

      <template v-for="row in visibleRows" :key="row.Key">
        <div
          v-if="row.Type === 'section'"
          class="location-section-label"
          :class="{ 'registry-section-divider': row.Key.includes('section:all') }"
        ><span>{{ row.Label }}</span></div>

        <div
          v-else-if="row.Type === 'group'"
          class="location-tree-row location-tree-group-row"
          :class="{ 'is-selected': isRowSelected(row), 'is-interactive': row.HasExpandableChildren || isGroupSelectable(row) }"
          :style="rowIndent(row)"
        >
          <button
            v-if="row.HasExpandableChildren"
            type="button"
            class="location-tree-toggle"
            :class="{ 'is-expanded': isExpanded(row.Key) }"
            :aria-expanded="isExpanded(row.Key)"
            :aria-label="isExpanded(row.Key) ? '收起下级地点' : '展开下级地点'"
            :data-tip="isExpanded(row.Key) ? '收起下级地点' : '展开下级地点'"
            @mousedown.stop.prevent="toggleExpanded(row)"
          ><img :src="ICONS.chevronDown" alt="" /></button>
          <span v-else class="location-tree-toggle-spacer" aria-hidden="true"></span>
          <button
            v-if="isGroupSelectable(row)"
            type="button"
            class="location-tree-label location-tree-group-label"
            :data-tip="getGroupTooltip(row)"
            @mousedown.prevent="selectRow(row)"
          >{{ row.Label }}</button>
          <span v-else class="location-tree-label location-tree-group-label">{{ row.Label }}</span>
        </div>

        <div
          v-else-if="row.Location"
          class="location-tree-row location-tree-location-row is-interactive"
          :class="{ 'is-selected': selectedLocationId === row.Location.LocationId }"
          :style="rowIndent(row)"
        >
          <button
            v-if="row.HasExpandableChildren && !row.Pinned"
            type="button"
            class="location-tree-toggle"
            :class="{ 'is-expanded': isExpanded(row.Key) }"
            :aria-expanded="isExpanded(row.Key)"
            :aria-label="isExpanded(row.Key) ? '收起子地点' : '展开子地点'"
            :data-tip="isExpanded(row.Key) ? '收起子地点' : '展开子地点'"
            @mousedown.stop.prevent="toggleExpanded(row)"
          ><img :src="ICONS.chevronDown" alt="" /></button>
          <span v-else class="location-tree-toggle-spacer" aria-hidden="true"></span>
          <button
            type="button"
            class="location-tree-label location-tree-location-label"
            :data-tip="getLocationTooltip(row.Location.LocationId)"
            @mousedown.prevent="selectRow(row)"
          >{{ row.Label }}</button>
        </div>
      </template>

      <div class="tag-option-empty" v-if="!hasHierarchyRows">{{ emptyText }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import { LOCATION_CONTEXT } from "../context/renderer-contexts.js";
import {
  getDefaultLocationExpansionKeys,
  getLocationRegionFilterLabel,
  getVisibleLocationHierarchyRows,
  sameLocationRegionFilter,
} from "../domain/location-hierarchy.mjs";

const props = defineProps({
  rows: { type: Array, default: () => [] },
  searchText: { type: String, default: "" },
  searchPlaceholder: { type: String, default: "搜索地点" },
  selectedLocationId: { type: String, default: "" },
  selectedRegion: { type: Object, default: null },
  mode: { type: String, default: "location" },
  showAllOption: { type: Boolean, default: false },
  allSelected: { type: Boolean, default: false },
  emptyText: { type: String, default: "没有匹配的地点" },
});

const emit = defineEmits([
  "update:searchText",
  "select-location",
  "select-region",
  "select-all",
  "clear-selection",
  "close",
]);

const app = inject(LOCATION_CONTEXT);
if (!app) throw new Error("LocationTreeMenu requires LOCATION_CONTEXT");
const { ICONS, getLocationTooltip } = app;

const expandedKeys = ref(new Set(getDefaultLocationExpansionKeys(props.rows)));
const searchInputRef = ref(null);
const searchActive = computed(() => Boolean(props.searchText.trim()));
const visibleRows = computed(() => getVisibleLocationHierarchyRows(
  props.rows,
  expandedKeys.value,
  searchActive.value,
));
const hasHierarchyRows = computed(() => visibleRows.value.some((row) => (
  row.Type === "group" || row.Type === "location"
)));

function isExpanded(key) {
  return expandedKeys.value.has(key);
}

function toggleExpanded(row) {
  const next = new Set(expandedKeys.value);
  const keys = row.Type === "group"
    ? [row.Key, `group-locations:${row.Key}`]
    : [row.Key];
  if (next.has(row.Key)) keys.forEach((key) => next.delete(key));
  else keys.forEach((key) => next.add(key));
  expandedKeys.value = next;
}

function rowIndent(row) {
  return { paddingLeft: `${4 + Math.max(0, Number(row.Depth || 0)) * 16}px` };
}

function isKnownRegion(region) {
  return ["country", "province", "city"].includes(String(region?.level || ""));
}

function isGroupSelectable(row) {
  if (props.mode === "filter") return isKnownRegion(row.Region);
  return Boolean(row.Location);
}

function isRowSelected(row) {
  if (props.mode === "filter") {
    return Boolean(props.selectedRegion && isKnownRegion(row.Region)
      && sameLocationRegionFilter(props.selectedRegion, row.Region));
  }
  return Boolean(row.Location && props.selectedLocationId === row.Location.LocationId);
}

function getGroupTooltip(row) {
  if (props.mode === "filter" && isKnownRegion(row.Region)) {
    return `筛选 ${getLocationRegionFilterLabel(row.Region)} 下的全部地点`;
  }
  return row.Location ? getLocationTooltip(row.Location.LocationId) : "";
}

function selectRow(row) {
  if (row.Type === "group" && props.mode === "filter") {
    if (isKnownRegion(row.Region)) emit("select-region", row.Region);
    return;
  }
  if (row.Location) emit("select-location", row.Location.LocationId);
}

function updateSearch(event) {
  emit("update:searchText", event.target.value);
}

function firstSelectableRow() {
  return visibleRows.value.find((row) => (
    row.Location || (row.Type === "group" && isGroupSelectable(row))
  ));
}

function onSearchKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    const first = firstSelectableRow();
    if (first) selectRow(first);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }
  if (event.key === "Backspace" && !props.searchText && props.selectedLocationId && props.mode === "location") {
    event.preventDefault();
    emit("clear-selection");
  }
}

onMounted(() => {
  searchInputRef.value?.focus();
});
</script>
