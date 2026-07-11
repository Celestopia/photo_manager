<template>
  <div class="album-picker location-picker" @click.stop>
    <div class="album-control">
      <div class="album-input-wrap">
        <button
          type="button"
          class="input album-input registry-trigger"
          :data-tip="selectedLocation ? getLocationTooltip(selectedLocation) : ''"
          @click="openLocationDropdown(target)"
        ><span>{{ selectedLocation || placeholder }}</span></button>
        <button
          type="button"
          class="album-clear-btn"
          v-if="selectedLocation"
          data-tip="将当前图片设为无地点"
          aria-label="将当前图片设为无地点"
          @click.stop="clearLocationForTarget(target)"
        >×</button>
        <div class="tag-dropdown location-dropdown" v-if="locationDropdown[target]">
          <input
            autofocus
            class="input dropdown-search-input location-dropdown-search"
            v-model="locationSearch[target]"
            @keydown="onLocationSearchKeydown($event, target)"
            :placeholder="searchPlaceholder"
            autocomplete="off"
          />
          <div class="location-dropdown-current-context" v-if="locationDropdownContext">{{ locationDropdownContext }}</div>
          <div class="location-dropdown-scroll" ref="locationDropdownRef" @scroll="updateLocationDropdownContext">
            <template v-for="row in locationMenuRows" :key="target + '_' + row.Key">
              <div v-if="row.Type === 'section'" class="location-section-label">{{ row.Label }}</div>
              <button
                v-else-if="row.Location"
                type="button"
                class="tag-option location-option"
                :class="{ 'location-group-selectable': row.Type === 'group' }"
                :data-tip="getLocationTooltip(row.Location.Name)"
                :data-location-context="getLocationManagerRowContext(row)"
                :data-location-recent="row.Key.startsWith('recent-location:') ? '1' : null"
                :style="{ paddingLeft: 16 + row.Depth * 16 + 'px' }"
                @mousedown.prevent="setLocationForTarget(target, row.Location.Name)"
              >
                <span>{{ row.Label }}</span>
              </button>
              <div
                v-else
                class="location-group-row"
                :style="{ paddingLeft: 16 + row.Depth * 16 + 'px' }"
              >{{ row.Label }}</div>
            </template>
            <div class="tag-option-empty" v-if="!locationMenuRows.length">没有匹配的地点</div>
          </div>
        </div>
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
      <div class="album-input-wrap">
        <input
          class="input"
          v-model="locationCreate.parentSearch"
          :placeholder="locationCreate.parent || '搜索父地点，可留空'"
          @focus="locationCreate.parentDropdown = true"
          @input="locationCreate.parentDropdown = true"
        />
        <button
          type="button"
          class="album-clear-btn"
          v-if="locationCreate.parent"
          data-tip="清空父节点"
          @click.stop="clearCreateLocationParent"
        >×</button>
        <div class="tag-dropdown location-dropdown" v-if="locationCreate.parentDropdown">
          <template v-for="row in createParentRows" :key="target + '_parent_' + row.Key">
            <button
              v-if="row.Location"
              type="button"
              class="tag-option location-option"
              :class="{ 'location-group-selectable': row.Type === 'group' }"
              :data-tip="getLocationTooltip(row.Location.Name)"
              :style="{ paddingLeft: 16 + row.Depth * 16 + 'px' }"
              @mousedown.prevent="setCreateLocationParent(row.Location.Name)"
            >
              <span>{{ row.Label }}</span>
            </button>
            <div
              v-else
              class="location-group-row"
              :style="{ paddingLeft: 16 + row.Depth * 16 + 'px' }"
            >{{ row.Label }}</div>
          </template>
          <div class="tag-option-empty" v-if="!createParentRows.length">没有匹配的父地点</div>
        </div>
      </div>
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
import { computed, inject, nextTick, ref, watch } from "vue";

const props = defineProps({
  target: { type: String, required: true },
  placeholder: { type: String, default: "搜索地点" },
  searchPlaceholder: { type: String, default: "搜索地点" },
});

const app = inject("appContext");
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
  getLocationParentRows,
  getLocationTooltip,
  getLocationManagerRowContext,
  openLocationDropdown,
  setLocationForTarget,
  clearLocationForTarget,
  onLocationSearchKeydown,
  openCreateLocationMenu,
  closeCreateLocationMenu,
  createLocationAndSelect,
  setCreateLocationParent,
  clearCreateLocationParent,
  openLocationManager,
} = app;

const target = props.target;
const selectedLocation = computed(() => (props.target === "batch" ? batchEdit.locationPlace : editDraft.LocationPlace));
const locationMenuRows = computed(() => getLocationMenuRows(props.target));
const createParentRows = computed(() => getLocationParentRows(locationCreate.parentSearch, locationCreate.name));
const locationDropdownRef = ref(null);
const locationDropdownContext = ref("");

function updateLocationDropdownContext() {
  const list = locationDropdownRef.value;
  if (!list) {
    locationDropdownContext.value = "";
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
  locationDropdownContext.value = current?.dataset?.locationRecent === "1" ? "" : current?.dataset?.locationContext || "";
}

function scheduleLocationDropdownContextUpdate() {
  if (!locationDropdown[props.target]) {
    locationDropdownContext.value = "";
    return;
  }
  nextTick(() => updateLocationDropdownContext());
}

watch(
  () => [locationDropdown[props.target], locationMenuRows.value.length, locationSearch[props.target]],
  () => scheduleLocationDropdownContextUpdate()
);
</script>
