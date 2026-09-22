<template>
  <div class="tag-modal-backdrop" v-if="locationManager.visible" @click="closeLocationManager">
    <section class="tag-manager-modal" @click.stop>
      <header class="tag-manager-header">
        <h3>Manage Locations</h3>
        <div class="tag-manager-header-actions">
          <button class="btn icon-btn modal-symbol-btn" data-tip="Create location" :disabled="locationManager.saving" @click="openCreateLocationMenu('manager')">+</button>
          <button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="Close" aria-label="Close" :disabled="locationManager.saving" @click="closeLocationManager">×</button>
        </div>
      </header>
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
                <label>Location name</label><input autofocus class="input" v-model="locationManager.editName" :disabled="locationManager.saving" @keydown.enter.exact.prevent="saveLocationEdit" @keydown.escape.prevent="cancelLocationEdit" />
                <label>Country</label><input class="input" v-model="locationManager.editCountry" :disabled="locationManager.saving" />
                <label>State/Province</label><input class="input" v-model="locationManager.editProvince" :disabled="locationManager.saving" />
                <label>City</label><input class="input" v-model="locationManager.editCity" :disabled="locationManager.saving" />
                <label>Parent</label>
                <LocationParentPicker
                  class="location-manager-parent-control"
                  :model-value="locationManager.editParentId || ''"
                  :exclude-id="row.Location.LocationId"
                  placeholder="No parent"
                  :disabled="locationManager.saving"
                  @update:model-value="setEditLocationParent"
                />
                <label>Description</label><textarea class="input tag-manager-description-input" v-model="locationManager.editDescription" placeholder="Optional" :disabled="locationManager.saving" @keydown.ctrl.enter.prevent="saveLocationEdit"></textarea>
              </div>
              <div class="tag-manager-error" v-if="locationManager.error && locationManager.editingId === row.Location.LocationId">{{ locationManager.error }}</div>
            </div>
            <div class="tag-manager-actions" v-if="locationManager.editingId === row.Location.LocationId"><button class="btn btn-primary" :disabled="locationManager.saving" @click="saveLocationEdit">Save</button><button class="btn" :disabled="locationManager.saving" @click="cancelLocationEdit">Cancel</button></div>
            <div class="tag-manager-actions" v-else><button class="btn" :disabled="locationManager.saving" @click="startLocationEdit(row.Location)">Edit</button><button class="btn danger-text" :disabled="locationManager.saving" @click="deleteLocationGlobally(row.Location)">Delete Globally</button></div>
          </article>
        </template>
        <div class="tag-manager-empty" v-if="!managerLocationRows.length">No matching locations</div>
      </div>
    </section>
  </div>

  <div class="registry-create-backdrop" v-if="locationCreate.visible && locationCreate.target === 'manager'" @click="closeCreateLocationMenu">
    <section class="registry-create-modal registry-create-location-modal" @click.stop>
      <header class="tag-manager-header"><h3>Create Location</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="Close" aria-label="Close" @click="closeCreateLocationMenu" :disabled="locationManager.saving">×</button></header>
      <div class="tag-manager-create-panel">
        <label>Location name</label><input class="input" v-model="locationCreate.name" :disabled="locationManager.saving" />
        <label>Country</label><input class="input" v-model="locationCreate.country" :disabled="locationManager.saving" />
        <label>State/Province</label><input class="input" v-model="locationCreate.province" :disabled="locationManager.saving" />
        <label>City</label><input class="input" v-model="locationCreate.city" :disabled="locationManager.saving" />
        <label>Parent</label>
        <LocationParentPicker
          :model-value="locationCreate.parentId || ''"
          :disabled="locationManager.saving"
          @update:model-value="setCreateLocationParent"
        />
        <label>Description (optional)</label><textarea class="input tag-create-description" v-model="locationCreate.description" :disabled="locationManager.saving"></textarea>
        <div class="tag-create-error" v-if="locationCreate.error">{{ locationCreate.error }}</div>
        <div class="tag-create-actions"><button class="btn" @click="closeCreateLocationMenu" :disabled="locationManager.saving">Cancel</button><button class="btn btn-primary" @click="createLocationAndSelect" :disabled="locationManager.saving">Create</button></div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { inject } from "vue";
import { LOCATION_CONTEXT } from "../../context/renderer-contexts.js";
import LocationParentPicker from "../LocationParentPicker.vue";
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
