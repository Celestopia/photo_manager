<template>
  <div class="tag-picker" @click.stop>
    <div class="controlled-tag-control">
      <div class="tag-editor controlled-tag-editor">
      <span
        class="tag-chip"
        v-for="(person, index) in selectedPeople"
        :key="target + '_' + person + '_' + index"
        :data-tip="getPersonDescription(person)"
      >
        <span>{{ person }}</span>
        <button type="button" class="tag-remove" @click.stop="removeSelectedPerson(index)">×</button>
      </span>
      <div class="tag-search-wrap">
        <input
          class="tag-input"
          v-model="personSearch[target]"
          @focus="openPersonDropdown(target)"
          @input="openPersonDropdown(target)"
          @keydown="onPersonSearchKeydown($event, target)"
          :placeholder="placeholder"
          autocomplete="off"
        />
        <div class="tag-dropdown" v-if="personDropdown[target]">
          <button
            v-for="person in personOptions"
            :key="target + '_person_option_' + person.Name"
            type="button"
            class="tag-option"
            :data-tip="person.Description"
            @mousedown.prevent="addPersonToTarget(target, person.Name)"
          >
            <span>{{ person.Name }}</span>
          </button>
          <div class="tag-option-empty" v-if="!personOptions.length">没有匹配的人物</div>
        </div>
      </div>
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

const props = defineProps({
  target: { type: String, required: true },
  placeholder: { type: String, default: "搜索人物" },
});

const app = inject("appContext");
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
  getPersonDescription,
  openPersonDropdown,
  addPersonToTarget,
  onPersonSearchKeydown,
  openCreatePersonMenu,
  closeCreatePersonMenu,
  createPersonAndSelect,
  openPersonManager,
  removePersonAt,
  removeBatchPersonAt,
} = app;

const target = props.target;
const selectedPeople = computed(() => (props.target === "batch" ? batchEdit.people : editDraft.People));
const personOptions = computed(() => getPersonOptions(props.target));

function removeSelectedPerson(index) {
  if (props.target === "batch") removeBatchPersonAt(index);
  else removePersonAt(index);
}
</script>
