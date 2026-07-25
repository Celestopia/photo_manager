<template>
  <div class="tag-dropdown searchable-dropdown selection-dropdown registry-options-menu" @click.stop>
    <input
      ref="searchInputRef"
      class="input dropdown-search-input"
      :value="searchText"
      :placeholder="searchPlaceholder"
      autocomplete="off"
      @input="emit('update:searchText', $event.target.value)"
      @keydown="onSearchKeydown"
    />
    <div class="registry-dropdown-options">
      <button
        v-for="option in fixedOptions"
        :key="`fixed_${option.value}`"
        type="button"
        class="tag-option"
        :class="{ 'is-selected': isSelected(option.value) }"
        @mousedown.prevent="emit('select', option.value)"
      ><span>{{ option.label }}</span></button>

      <template v-if="recentOptions.length">
        <div
          class="registry-section-label"
          :class="{ 'registry-section-divider': fixedOptions.length }"
        ><span>{{ recentSectionLabel }}</span></div>
        <button
          v-for="option in recentOptions"
          :key="`recent_${optionValue(option)}`"
          type="button"
          class="tag-option"
          :class="{ 'is-selected': isSelected(optionValue(option)) }"
          :data-tip="optionDescription(option)"
          @mousedown.prevent="emit('select', optionValue(option))"
        ><span>{{ optionLabel(option) }}</span></button>
      </template>

      <div
        v-if="showAllSectionLabel"
        class="registry-section-label"
        :class="{ 'registry-section-divider': fixedOptions.length || recentOptions.length }"
      ><span>{{ allSectionLabel }}</span></div>
      <div
        v-else-if="fixedOptions.length || recentOptions.length"
        class="registry-section-divider"
        aria-hidden="true"
      ></div>
      <button
        v-for="option in options"
        :key="`all_${optionValue(option)}`"
        type="button"
        class="tag-option"
        :class="{ 'is-selected': isSelected(optionValue(option)) }"
        :data-tip="optionDescription(option)"
        @mousedown.prevent="emit('select', optionValue(option))"
      ><span>{{ optionLabel(option) }}</span></button>
      <div class="tag-option-empty" v-if="!options.length">{{ emptyText }}</div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from "vue";

const props = defineProps({
  searchText: { type: String, default: "" },
  searchPlaceholder: { type: String, default: "搜索" },
  options: { type: Array, default: () => [] },
  recentOptions: { type: Array, default: () => [] },
  fixedOptions: { type: Array, default: () => [] },
  selectedValues: { type: Array, default: () => [] },
  idKey: { type: String, required: true },
  labelKey: { type: String, required: true },
  descriptionKey: { type: String, default: "Description" },
  recentSectionLabel: { type: String, default: "最近使用" },
  allSectionLabel: { type: String, default: "全部" },
  showAllSectionLabel: { type: Boolean, default: true },
  emptyText: { type: String, required: true },
});

const emit = defineEmits([
  "update:searchText",
  "select",
  "close",
  "backspace-empty",
]);

const searchInputRef = ref(null);

function optionValue(option) {
  return String(option?.[props.idKey] || "");
}

function optionLabel(option) {
  return String(option?.[props.labelKey] || "");
}

function optionDescription(option) {
  return String(option?.[props.descriptionKey] || "");
}

function isSelected(value) {
  return props.selectedValues.includes(value);
}

function onSearchKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    const first = props.recentOptions[0] || props.options[0];
    if (first) emit("select", optionValue(first));
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }
  if (event.key === "Backspace" && !props.searchText) {
    event.preventDefault();
    emit("backspace-empty");
  }
}

onMounted(() => {
  searchInputRef.value?.focus();
});
</script>
