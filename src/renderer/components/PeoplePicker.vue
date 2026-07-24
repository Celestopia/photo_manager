<template>
  <div class="tag-picker" @click.stop>
    <div class="controlled-tag-control">
      <div class="tag-editor controlled-tag-editor">
      <span
        class="tag-chip"
        v-for="(personId, index) in selectedPersonIds"
        :key="target + '_' + personId"
        :data-tip="getPersonDescription(personId)"
      >
        <span>{{ getPersonName(personId) }}</span>
        <button type="button" class="tag-remove" @click.stop="removeSelectedPerson(index)">×</button>
      </span>
      <button type="button" class="tag-editor-trigger" @click="openPersonDropdown(target)">
        <span v-if="!selectedPersonIds.length">{{ placeholder }}</span>
        <span v-else>选择人物</span>
      </button>
        <RegistryOptionsMenu
          v-if="personDropdown[target]"
          class="controlled-tag-dropdown"
          :search-text="personSearch[target]"
          :search-placeholder="searchPlaceholder"
          :options="personOptions"
          :recent-options="recentPersonOptions"
          :selected-values="selectedPersonIds"
          id-key="PersonId"
          label-key="Name"
          all-section-label="全部人物"
          empty-text="没有匹配的人物"
          @update:search-text="personSearch[target] = $event"
          @select="addPersonToTarget(target, $event)"
          @close="closePersonDropdown(target)"
          @backspace-empty="removeSelectedPerson(selectedPersonIds.length - 1)"
        />
      </div>
      <div class="tag-actions">
        <button type="button" class="btn icon-btn tag-inline-btn" data-tip="新建人物" @click.stop="openCreatePersonMenu(target)">+</button>
        <button type="button" class="btn icon-btn tag-inline-btn" data-tip="人物管理" @click.stop="openPersonManager">
          <img class="icon" :src="ICONS.settings" alt="人物管理" />
        </button>
      </div>
    </div>
    <div class="tag-create-popover" v-if="personCreate.visible && personCreate.target === target" @click.stop>
      <label>人物姓名</label>
      <input class="input" v-model="personCreate.name" />
      <label>说明（可留空）</label>
      <textarea class="input tag-create-description" v-model="personCreate.description"></textarea>
      <div class="tag-create-error" v-if="personCreate.error">{{ personCreate.error }}</div>
      <div class="tag-create-actions">
        <button class="btn" @click="closeCreatePersonMenu">取消</button>
        <button class="btn btn-primary" @click="createPersonAndSelect">创建并添加</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, inject } from "vue";
import { PERSON_CONTEXT } from "../context/renderer-contexts.js";
import RegistryOptionsMenu from "./RegistryOptionsMenu.vue";

const props = defineProps({
  target: { type: String, required: true },
  placeholder: { type: String, default: "搜索人物" },
  searchPlaceholder: { type: String, default: "搜索人物" },
});

const app = inject(PERSON_CONTEXT);
if (!app) {
  throw new Error("PeoplePicker must be used under App.vue provider");
}

const {
  ICONS,
  editDraft,
  batchEdit,
  personSearch,
  personDropdown,
  personCreate,
  getPersonOptions,
  getRecentPersonOptions,
  getPersonDescription,
  getPersonName,
  openPersonDropdown,
  closePersonDropdown,
  addPersonToTarget,
  openCreatePersonMenu,
  closeCreatePersonMenu,
  createPersonAndSelect,
  openPersonManager,
  removePersonAt,
  removeBatchPersonAt,
} = app;

const target = props.target;
const selectedPersonIds = computed(() => (props.target === "batch" ? batchEdit.personIds : editDraft.PersonIds));
const personOptions = computed(() => getPersonOptions(props.target));
const recentPersonOptions = computed(() => getRecentPersonOptions(props.target));

function removeSelectedPerson(index) {
  if (index < 0) return;
  if (props.target === "batch") removeBatchPersonAt(index);
  else removePersonAt(index);
}
</script>
