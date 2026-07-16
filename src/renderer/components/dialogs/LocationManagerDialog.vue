<template>
  <div class="tag-modal-backdrop" v-if="locationManager.visible" @click="closeLocationManager">
    <section class="tag-manager-modal" @click.stop>
      <header class="tag-manager-header">
        <h3>地点管理</h3>
        <div class="tag-manager-header-actions">
          <button class="btn icon-btn modal-symbol-btn" data-tip="新建地点" :disabled="locationManager.saving" @click="openCreateLocationMenu('manager')">+</button>
          <button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" :disabled="locationManager.saving" @click="closeLocationManager">×</button>
        </div>
      </header>
      <div class="tag-manager-controls"><input class="input tag-manager-search" v-model="locationManager.search" placeholder="搜索地点、说明或行政区" /></div>
      <div class="location-manager-current-context" v-if="locationManagerContext">{{ locationManagerContext }}</div>
      <div class="tag-manager-list location-manager-list" ref="locationManagerListRef" @scroll="updateLocationManagerContext">
        <template v-for="row in managerLocationRows" :key="'location_manager_' + row.Key">
          <div v-if="row.Type === 'group' && !row.Location" class="location-manager-group-row" :style="{ paddingLeft: 12 + row.Depth * 18 + 'px' }">{{ row.Label }}</div>
          <article
            v-else-if="row.Location"
            class="tag-manager-item location-manager-item"
            :style="{ marginLeft: row.Depth * 18 + 'px' }"
            :data-location-context="getLocationManagerRowContext(row)"
          >
            <div class="tag-manager-item-main">
              <div class="tag-manager-item-title location-manager-item-title">
                <div class="location-manager-title-text"><strong>{{ row.Label }}</strong><small v-if="row.Location.Description">{{ row.Location.Description }}</small></div>
                <span>{{ row.Location.UsageCount || 0 }} 个媒体</span>
              </div>
              <div v-if="locationManager.editingId === row.Location.LocationId" class="location-manager-edit">
                <label>地点名称</label><input autofocus class="input" v-model="locationManager.editName" :disabled="locationManager.saving" @keydown.enter.exact.prevent="saveLocationEdit" @keydown.escape.prevent="cancelLocationEdit" />
                <label>国家</label><input class="input" v-model="locationManager.editCountry" :disabled="locationManager.saving" />
                <label>省</label><input class="input" v-model="locationManager.editProvince" :disabled="locationManager.saving" />
                <label>市</label><input class="input" v-model="locationManager.editCity" :disabled="locationManager.saving" />
                <label>父节点</label>
                <select class="input" v-model="locationManager.editParentId" :disabled="locationManager.saving">
                  <option :value="null">无父节点</option>
                  <option v-for="option in getLocationParentOptions('', row.Location.LocationId)" :key="'manager_parent_' + row.Location.LocationId + '_' + option.LocationId" :value="option.LocationId">{{ getLocationTreeLabel(option) }}</option>
                </select>
                <label>说明</label><textarea class="input tag-manager-description-input" v-model="locationManager.editDescription" placeholder="可留空" :disabled="locationManager.saving" @keydown.ctrl.enter.prevent="saveLocationEdit"></textarea>
              </div>
              <div class="tag-manager-error" v-if="locationManager.error && locationManager.editingId === row.Location.LocationId">{{ locationManager.error }}</div>
            </div>
            <div class="tag-manager-actions" v-if="locationManager.editingId === row.Location.LocationId"><button class="btn btn-primary" :disabled="locationManager.saving" @click="saveLocationEdit">保存</button><button class="btn" :disabled="locationManager.saving" @click="cancelLocationEdit">取消</button></div>
            <div class="tag-manager-actions" v-else><button class="btn" :disabled="locationManager.saving" @click="startLocationEdit(row.Location)">编辑</button><button class="btn danger-text" :disabled="locationManager.saving" @click="deleteLocationGlobally(row.Location)">全局删除</button></div>
          </article>
        </template>
        <div class="tag-manager-empty" v-if="!managerLocationRows.length">没有匹配的地点</div>
      </div>
    </section>
  </div>

  <div class="registry-create-backdrop" v-if="locationCreate.visible && locationCreate.target === 'manager'" @click="closeCreateLocationMenu">
    <section class="registry-create-modal registry-create-location-modal" @click.stop>
      <header class="tag-manager-header"><h3>新建地点</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" @click="closeCreateLocationMenu">×</button></header>
      <div class="tag-manager-create-panel">
        <label>地点名称</label><input class="input" v-model="locationCreate.name" />
        <label>国家</label><input class="input" v-model="locationCreate.country" />
        <label>省</label><input class="input" v-model="locationCreate.province" />
        <label>市</label><input class="input" v-model="locationCreate.city" />
        <label>父节点</label>
        <div class="album-input-wrap">
          <button type="button" class="input registry-trigger location-parent-trigger" @click="locationCreate.parentDropdown = !locationCreate.parentDropdown"><span>{{ getLocationName(locationCreate.parentId) || '选择父地点，可留空' }}</span></button>
          <button type="button" class="album-clear-btn" v-if="locationCreate.parentId" data-tip="清空父节点" @click.stop="clearCreateLocationParent">×</button>
          <div class="tag-dropdown location-dropdown" v-if="locationCreate.parentDropdown">
            <input autofocus class="input dropdown-search-input location-dropdown-search" v-model="locationCreate.parentSearch" placeholder="搜索父地点" @keydown.escape="locationCreate.parentDropdown = false" />
            <div class="location-dropdown-scroll">
              <template v-for="row in getLocationParentRows(locationCreate.parentSearch)" :key="'manager_create_parent_' + row.Key">
                <button v-if="row.Location" type="button" class="tag-option location-option" :class="{ 'location-group-selectable': row.Type === 'group' }" :data-tip="getLocationTooltip(row.Location.LocationId)" :style="{ paddingLeft: 8 + row.Depth * 16 + 'px' }" @mousedown.prevent="setCreateLocationParent(row.Location.LocationId)"><span>{{ row.Label }}</span></button>
                <div v-else class="location-group-row" :style="{ paddingLeft: 8 + row.Depth * 16 + 'px' }">{{ row.Label }}</div>
              </template>
              <div class="tag-option-empty" v-if="!getLocationParentRows(locationCreate.parentSearch).length">没有匹配的父地点</div>
            </div>
          </div>
        </div>
        <label>说明（可留空）</label><textarea class="input tag-create-description" v-model="locationCreate.description"></textarea>
        <div class="tag-create-error" v-if="locationCreate.error">{{ locationCreate.error }}</div>
        <div class="tag-create-actions"><button class="btn" @click="closeCreateLocationMenu">取消</button><button class="btn btn-primary" @click="createLocationAndSelect">创建</button></div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { inject } from "vue";
import { LOCATION_CONTEXT } from "../../context/renderer-contexts.js";
const context = inject(LOCATION_CONTEXT);
if (!context) throw new Error("LocationManagerDialog requires LOCATION_CONTEXT");
const {
  locationManager, locationManagerContext, locationManagerListRef, managerLocationRows,
  locationCreate, openCreateLocationMenu, closeLocationManager, updateLocationManagerContext,
  getLocationManagerRowContext, getLocationParentOptions, getLocationTreeLabel,
  startLocationEdit, saveLocationEdit, cancelLocationEdit, deleteLocationGlobally,
  closeCreateLocationMenu, getLocationParentRows, getLocationTooltip,
  getLocationName,
  setCreateLocationParent, clearCreateLocationParent, createLocationAndSelect,
} = context;
</script>
