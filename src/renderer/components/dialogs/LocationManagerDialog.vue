<template>
  <AppDialog v-if="locationManager.visible" class="tag-manager-modal" dismiss-on-backdrop :busy="locationManager.saving" @close="closeLocationManager">
      <template #header>
        <h3>Manage Locations</h3>
        <div class="tag-manager-header-actions">
          <button class="btn icon-btn modal-symbol-btn" data-tip="Create location" :disabled="locationManager.saving" @click="openCreateLocationMenu('manager')">+</button>
          <button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="Close" aria-label="Close" :disabled="locationManager.saving" @click="closeLocationManager">×</button>
        </div>
      </template>
      <div class="tag-manager-controls"><input class="input tag-manager-search" v-model="locationManager.search" placeholder="Search locations, descriptions, or regions" /></div>
      <div class="location-manager-fold-actions">
        <button class="btn" :disabled="locationManager.saving || managerSearchActive" @click="expandManagerLocations">Expand all</button>
        <button class="btn" data-tip="Collapse to city level" :disabled="managerFoldDisabled()" @click="collapseManagerLocations">Collapse all</button>
      </div>
      <div class="tag-manager-list location-manager-list" ref="locationManagerListRef">
        <template v-for="row in managerLocationRows" :key="'location_manager_' + row.Key">
          <div v-if="row.Type === 'group' && !row.Location" class="location-manager-group-row" :style="{ paddingLeft: 12 + row.Depth * 18 + 'px' }">
            <button v-if="row.HasExpandableChildren" type="button" class="location-tree-toggle" :class="{ 'is-expanded': managerRowExpanded(row) }" :aria-label="managerRowExpanded(row) ? 'Collapse child locations' : 'Expand child locations'" :data-tip="managerRowExpanded(row) ? 'Collapse child locations' : 'Expand child locations'" :aria-expanded="managerRowExpanded(row)" :disabled="managerFoldDisabled(row)" @click="toggleManagerRow(row)"><img :src="ICONS.chevronDown" alt="" /></button>
            <span v-else class="location-tree-toggle-spacer" aria-hidden="true"></span>
            <span :data-tip="managerRegionTooltip(row)">{{ row.Label }}</span>
          </div>
          <article
            v-else-if="row.Location"
            class="tag-manager-item location-manager-item"
            :style="{ marginLeft: row.Depth * 18 + 'px' }"
            :data-location-id="row.Location.LocationId"
          >
            <div class="tag-manager-item-main">
              <div class="tag-manager-item-title location-manager-item-title">
                <div class="location-manager-title-text"><button v-if="row.HasExpandableChildren" type="button" class="location-tree-toggle" :class="{ 'is-expanded': managerRowExpanded(row) }" :aria-label="managerRowExpanded(row) ? 'Collapse child locations' : 'Expand child locations'" :data-tip="managerRowExpanded(row) ? 'Collapse child locations' : 'Expand child locations'" :aria-expanded="managerRowExpanded(row)" :disabled="managerFoldDisabled(row)" @click="toggleManagerRow(row)"><img :src="ICONS.chevronDown" alt="" /></button><span v-else class="location-tree-toggle-spacer" aria-hidden="true"></span><strong :data-tip="managerRegionTooltip(row)">{{ row.Label }}</strong><small v-if="row.Location.Description">{{ row.Location.Description }}</small></div>
                <span :data-tip="managerRowExpanded(row) || !row.HasExpandableChildren ? 'Directly assigned to this location' : 'Includes descendant locations'">{{ managerLocationCount(row) }} {{ managerLocationCount(row) === 1 ? 'media item' : 'media items' }}</span>
              </div>
              <div v-if="locationManager.editingId === row.Location.LocationId" class="location-manager-edit">
                <LocationFields v-model:name="locationManager.editName" v-model:country="locationManager.editCountry" v-model:province="locationManager.editProvince" v-model:city="locationManager.editCity" v-model:description="locationManager.editDescription" :parent-id="locationManager.editParentId || ''" :disabled="locationManager.saving" @update:parent-id="setEditLocationParent" editing :exclude-id="row.Location.LocationId" @save="saveLocationEdit" @cancel="cancelLocationEdit" />
              </div>
              <div class="tag-manager-error" v-if="locationManager.error && locationManager.editingId === row.Location.LocationId">{{ locationManager.error }}</div>
            </div>
            <div class="tag-manager-actions" v-if="locationManager.editingId === row.Location.LocationId"><button class="btn btn-primary" :disabled="locationManager.saving" @click="saveLocationEdit">Save</button><button class="btn" :disabled="locationManager.saving" @click="cancelLocationEdit">Cancel</button></div>
            <div class="tag-manager-actions" v-else><button class="btn" :disabled="locationManager.saving" @click="startLocationEdit(row.Location)">Edit</button><button class="btn danger-text" :disabled="locationManager.saving" @click="deleteLocationGlobally(row.Location)">Delete Globally</button></div>
          </article>
        </template>
        <div class="tag-manager-empty" v-if="!managerLocationRows.length">No matching locations</div>
      </div>
    </AppDialog>

  <AppDialog v-if="locationCreate.visible && locationCreate.target === 'manager'" class="registry-create-modal registry-create-location-modal" dismiss-on-backdrop :busy="locationManager.saving" @close="closeCreateLocationMenu">
      <template #header><h3>Create Location</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="Close" aria-label="Close" @click="closeCreateLocationMenu" :disabled="locationManager.saving">×</button></template>
      <div class="tag-manager-create-panel">
        <LocationFields v-model:name="locationCreate.name" v-model:country="locationCreate.country" v-model:province="locationCreate.province" v-model:city="locationCreate.city" v-model:description="locationCreate.description" :parent-id="locationCreate.parentId || ''" :disabled="locationManager.saving" @update:parent-id="setCreateLocationParent" />
        <div class="tag-create-error" v-if="locationCreate.error">{{ locationCreate.error }}</div>
        <div class="tag-create-actions"><button class="btn" @click="closeCreateLocationMenu" :disabled="locationManager.saving">Cancel</button><button class="btn btn-primary" @click="createLocationAndSelect" :disabled="locationManager.saving">Create</button></div>
      </div>
    </AppDialog>
</template>

<script setup>
import AppDialog from "./AppDialog.vue";
import { inject } from "vue";
import { LOCATION_CONTEXT } from "../../context/renderer-contexts.js";
import LocationFields from "../LocationFields.vue";
const context = inject(LOCATION_CONTEXT);
if (!context) throw new Error("LocationManagerDialog requires LOCATION_CONTEXT");
const {
  ICONS, locationManager, locationManagerListRef, managerLocationRows,
  managerRegionTooltip, managerLocationCount, managerSearchActive, managerRowExpanded, managerFoldDisabled, toggleManagerRow, expandManagerLocations, collapseManagerLocations,
  locationCreate, openCreateLocationMenu, closeLocationManager,
  startLocationEdit, saveLocationEdit, cancelLocationEdit, deleteLocationGlobally,
  closeCreateLocationMenu, setEditLocationParent,
  setCreateLocationParent, createLocationAndSelect,
} = context;
</script>
