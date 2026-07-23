<template>
  <div class="album-picker location-picker" @click.stop>
    <div class="album-control">
      <div class="album-input-wrap">
        <button
          type="button"
          class="input album-input registry-trigger"
          :class="{ 'is-placeholder': !selectedLocationId }"
          :data-tip="selectedLocationId ? getLocationTooltip(selectedLocationId) : ''"
          @click="openLocationDropdown(target)"
        ><span>{{ selectedLocationName || placeholder }}</span></button>
        <button
          type="button"
          class="album-clear-btn"
          v-if="selectedLocationId"
          data-tip="将当前媒体设为无地点"
          aria-label="将当前媒体设为无地点"
          @click.stop="clearLocationForTarget(target)"
        >×</button>
        <LocationTreeMenu
          v-if="locationDropdown[target]"
          :class="`location-tree-menu-${target}`"
          :rows="locationMenuRows"
          :search-text="locationSearch[target]"
          :search-placeholder="searchPlaceholder"
          :selected-location-id="selectedLocationId || ''"
          mode="location"
          @update:search-text="locationSearch[target] = $event"
          @select-location="setLocationForTarget(target, $event)"
          @clear-selection="clearLocationForTarget(target)"
          @close="closeLocationDropdown(target)"
        />
      </div>
      <div class="tag-actions">
        <button type="button" class="btn icon-btn tag-inline-btn" data-tip="新建地点" @click.stop="openCreateLocationMenu(target)">+</button>
        <button type="button" class="btn icon-btn tag-inline-btn" data-tip="地点管理" @click.stop="openLocationManager">
          <img class="icon" :src="ICONS.settings" alt="地点管理" />
        </button>
      </div>
    </div>
    <div class="tag-create-popover" v-if="locationCreate.visible && locationCreate.target === target" @click.stop>
      <label>地点名称</label>
      <input class="input" v-model="locationCreate.name" />
      <label>国家</label>
      <input class="input" v-model="locationCreate.country" />
      <label>省</label>
      <input class="input" v-model="locationCreate.province" />
      <label>市</label>
      <input class="input" v-model="locationCreate.city" />
      <label>父节点</label>
      <LocationParentPicker
        :model-value="locationCreate.parentId || ''"
        @update:model-value="setCreateLocationParent"
      />
      <label>说明（可留空）</label>
      <textarea class="input tag-create-description location-create-description" v-model="locationCreate.description"></textarea>
      <div class="tag-create-error" v-if="locationCreate.error">{{ locationCreate.error }}</div>
      <div class="tag-create-actions">
        <button class="btn" @click="closeCreateLocationMenu">取消</button>
        <button class="btn btn-primary" @click="createLocationAndSelect">创建并设置</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, inject } from "vue";
import { LOCATION_CONTEXT } from "../context/renderer-contexts.js";
import LocationParentPicker from "./LocationParentPicker.vue";
import LocationTreeMenu from "./LocationTreeMenu.vue";

const props = defineProps({
  target: { type: String, required: true },
  placeholder: { type: String, default: "搜索地点" },
  searchPlaceholder: { type: String, default: "搜索地点" },
});

const app = inject(LOCATION_CONTEXT);
if (!app) {
  throw new Error("LocationPicker must be used under App.vue provider");
}

const {
  ICONS,
  editDraft,
  batchEdit,
  locationSearch,
  locationDropdown,
  locationCreate,
  getLocationMenuRows,
  getLocationTooltip,
  getLocationName,
  openLocationDropdown,
  closeLocationDropdown,
  setLocationForTarget,
  clearLocationForTarget,
  openCreateLocationMenu,
  closeCreateLocationMenu,
  createLocationAndSelect,
  setCreateLocationParent,
  openLocationManager,
} = app;

const target = props.target;
const selectedLocationId = computed(() => (props.target === "batch" ? batchEdit.locationId : editDraft.LocationId));
const selectedLocationName = computed(() => getLocationName(selectedLocationId.value));
const locationMenuRows = computed(() => getLocationMenuRows(props.target));
</script>
