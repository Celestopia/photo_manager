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
          data-tip="Clear location for current media"
          aria-label="Clear location for current media"
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
        <button type="button" class="btn icon-btn tag-inline-btn" data-tip="Create location" @click.stop="openCreateLocationMenu(target)">+</button>
        <button type="button" class="btn icon-btn tag-inline-btn" data-tip="Manage locations" @click.stop="openLocationManager">
          <img class="icon" :src="ICONS.settings" alt="Manage locations" />
        </button>
      </div>
    </div>
    <div class="tag-create-popover" v-if="locationCreate.visible && locationCreate.target === target" @click.stop>
      <label>Location name</label>
      <input class="input" v-model="locationCreate.name" />
      <label>Country</label>
      <input class="input" v-model="locationCreate.country" />
      <label>State/Province</label>
      <input class="input" v-model="locationCreate.province" />
      <label>City</label>
      <input class="input" v-model="locationCreate.city" />
      <label>Parent location</label>
      <LocationParentPicker
        :model-value="locationCreate.parentId || ''"
        @update:model-value="setCreateLocationParent"
      />
      <label>Description (optional)</label>
      <textarea class="input tag-create-description location-create-description" v-model="locationCreate.description"></textarea>
      <div class="tag-create-error" v-if="locationCreate.error">{{ locationCreate.error }}</div>
      <div class="tag-create-actions">
        <button class="btn" @click="closeCreateLocationMenu">Cancel</button>
        <button class="btn btn-primary" @click="createLocationAndSelect">Create and Set</button>
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
  placeholder: { type: String, default: "Search locations" },
  searchPlaceholder: { type: String, default: "Search locations" },
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
