<template>
  <div class="tag-picker" @click.stop>
    <div class="tag-editor controlled-tag-editor">
      <span
        class="tag-chip"
        v-for="(tag, index) in selectedTags"
        :key="target + '_' + tag + '_' + index"
        :data-tip="getTagDescription(tag)"
      >
        <span>{{ tag }}</span>
        <button type="button" class="tag-remove" @click.stop="removeSelectedTag(index)">×</button>
      </span>
      <div class="tag-search-wrap">
        <input
          class="tag-input"
          v-model="tagSearch[target]"
          @focus="openTagDropdown(target)"
          @input="openTagDropdown(target)"
          @keydown="onTagSearchKeydown($event, target)"
          :placeholder="placeholder"
          autocomplete="off"
        />
        <div class="tag-dropdown" v-if="tagDropdown[target]">
          <button
            v-for="tag in tagOptions"
            :key="target + '_option_' + tag.Text"
            type="button"
            class="tag-option"
            :data-tip="tag.Description"
            @mousedown.prevent="addTagToTarget(target, tag.Text)"
          >
            <span>{{ tag.Text }}</span>
          </button>
          <div class="tag-option-empty" v-if="!tagOptions.length">没有匹配的标签</div>
        </div>
      </div>
      <div class="tag-actions">
        <button type="button" class="btn icon-btn tag-inline-btn" data-tip="新建标签" @click.stop="openCreateTagMenu(target)">+</button>
        <button type="button" class="btn icon-btn tag-inline-btn" data-tip="标签管理" @click.stop="openTagManager">
          <img class="icon" :src="ICONS.settings" alt="标签管理" />
        </button>
      </div>
    </div>
    <div class="tag-create-popover" v-if="tagCreate.visible && tagCreate.target === target" @click.stop>
      <label>标签名称</label>
      <input class="input" v-model="tagCreate.text" />
      <label>说明</label>
      <textarea class="input tag-create-description" v-model="tagCreate.description"></textarea>
      <div class="tag-create-error" v-if="tagCreate.error">{{ tagCreate.error }}</div>
      <div class="tag-create-actions">
        <button class="btn" @click="closeCreateTagMenu">取消</button>
        <button class="btn btn-primary" @click="createTagAndSelect">创建并添加</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, inject } from "vue";

const props = defineProps({
  target: { type: String, required: true },
  placeholder: { type: String, default: "搜索标签" },
});

const app = inject("appContext");
if (!app) {
  throw new Error("TagPicker must be used under App.vue provider");
}

const {
  ICONS,
  editDraft,
  batchEdit,
  tagSearch,
  tagDropdown,
  tagCreate,
  getTagOptions,
  getTagDescription,
  openTagDropdown,
  addTagToTarget,
  onTagSearchKeydown,
  openCreateTagMenu,
  closeCreateTagMenu,
  createTagAndSelect,
  openTagManager,
  removeTagAt,
  removeBatchTagAt,
} = app;

const target = props.target;
const selectedTags = computed(() => (props.target === "batch" ? batchEdit.tags : editDraft.Tags));
const tagOptions = computed(() => getTagOptions(props.target));

function removeSelectedTag(index) {
  if (props.target === "batch") removeBatchTagAt(index);
  else removeTagAt(index);
}
</script>
