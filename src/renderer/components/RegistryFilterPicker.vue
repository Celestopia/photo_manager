<template>
  <div class="registry-filter-picker" @click.stop>
    <button type="button" class="input registry-trigger" @click="toggleDropdown">
      <span>{{ selectedLabel }}</span>
    </button>
    <div class="tag-dropdown registry-filter-dropdown" v-if="dropdownOpen">
      <input
        ref="searchInputRef"
        class="input dropdown-search-input"
        v-model="searchText"
        :placeholder="`搜索${label}`"
        @keydown.enter.prevent="selectFirstOption"
        @keydown.escape="closeDropdown"
      />
      <div class="registry-dropdown-options">
        <button type="button" class="tag-option" @mousedown.prevent="selectValue('')"><span>全部</span></button>
        <button
          v-if="kind === 'album' && filterOptions.unassignedAlbumCount > 0 && matches('未设置相册')"
          type="button"
          class="tag-option"
          @mousedown.prevent="selectValue(UNASSIGNED_ALBUM_FILTER)"
        ><span>未设置相册</span></button>
        <button
          v-for="option in filteredOptions"
          :key="`${kind}_${option}`"
          type="button"
          class="tag-option"
          :data-tip="getDescription(option)"
          @mousedown.prevent="selectValue(option)"
        ><span>{{ option }}</span></button>
        <div class="tag-option-empty" v-if="!filteredOptions.length && !hasUnassignedMatch">没有匹配的{{ label }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps({
  kind: { type: String, required: true },
  label: { type: String, required: true },
});

const app = inject("appContext");
if (!app) throw new Error("RegistryFilterPicker must be used under App.vue provider");

const {
  query,
  filterOptions,
  UNASSIGNED_ALBUM_FILTER,
  getAlbumDescription,
  getTagDescription,
  getPersonDescription,
  applyFilterSort,
} = app;

const dropdownOpen = ref(false);
const pickerId = Symbol(props.kind);
const searchText = ref("");
const searchInputRef = ref(null);
const selectedValue = computed(() => query.filters[props.kind] || "");
const selectedLabel = computed(() => {
  if (!selectedValue.value) return "全部";
  if (selectedValue.value === UNASSIGNED_ALBUM_FILTER) return "未设置相册";
  return selectedValue.value;
});
const options = computed(() => filterOptions[props.kind === "person" ? "people" : `${props.kind}s`] || []);
const normalizedSearch = computed(() => searchText.value.trim().toLocaleLowerCase("zh-CN"));
const filteredOptions = computed(() => options.value.filter((option) => matches(option)));
const hasUnassignedMatch = computed(
  () => props.kind === "album" && filterOptions.unassignedAlbumCount > 0 && matches("未设置相册")
);

function matches(value) {
  return !normalizedSearch.value || String(value).toLocaleLowerCase("zh-CN").includes(normalizedSearch.value);
}

function getDescription(value) {
  if (props.kind === "album") return getAlbumDescription(value);
  if (props.kind === "tag") return getTagDescription(value);
  return getPersonDescription(value);
}

function closeDropdown() {
  dropdownOpen.value = false;
  searchText.value = "";
}

function toggleDropdown() {
  const nextOpen = !dropdownOpen.value;
  if (nextOpen) window.dispatchEvent(new CustomEvent("gallery-filter-picker-open", { detail: pickerId }));
  dropdownOpen.value = nextOpen;
}

function closeFromOtherPicker(event) {
  if (event.detail !== pickerId) closeDropdown();
}

async function selectValue(value) {
  query.filters[props.kind] = value;
  closeDropdown();
  await applyFilterSort();
}

async function selectFirstOption() {
  if (hasUnassignedMatch.value) return selectValue(UNASSIGNED_ALBUM_FILTER);
  if (filteredOptions.value.length) return selectValue(filteredOptions.value[0]);
}

watch(dropdownOpen, (open) => {
  if (open) nextTick(() => searchInputRef.value?.focus());
  else searchText.value = "";
});

onMounted(() => {
  window.addEventListener("click", closeDropdown);
  window.addEventListener("gallery-filter-picker-open", closeFromOtherPicker);
});

onBeforeUnmount(() => {
  window.removeEventListener("click", closeDropdown);
  window.removeEventListener("gallery-filter-picker-open", closeFromOtherPicker);
});
</script>
