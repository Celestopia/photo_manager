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
        <span v-else>Select people</span>
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
          all-section-label="All People"
          empty-text="No matching people"
          @update:search-text="personSearch[target] = $event"
          @select="addPersonToTarget(target, $event)"
          @close="closePersonDropdown(target)"
          @backspace-empty="removeSelectedPerson(selectedPersonIds.length - 1)"
        />
      </div>
      <div class="tag-actions">
        <button type="button" class="btn icon-btn tag-inline-btn" data-tip="Create person" @click.stop="openCreatePersonMenu(target)">+</button>
        <button type="button" class="btn icon-btn tag-inline-btn" data-tip="Manage people" @click.stop="openPersonManager">
          <img class="icon" :src="ICONS.settings" alt="Manage people" />
        </button>
      </div>
    </div>
    <div class="tag-create-popover" v-if="personCreate.visible && personCreate.target === target" @click.stop>
      <label>Person name</label>
      <input class="input" v-model="personCreate.name" />
      <label>Description (optional)</label>
      <textarea class="input tag-create-description" v-model="personCreate.description"></textarea>
      <div class="tag-create-error" v-if="personCreate.error">{{ personCreate.error }}</div>
      <div class="tag-create-actions">
        <button class="btn" @click="closeCreatePersonMenu">Cancel</button>
        <button class="btn btn-primary" @click="createPersonAndSelect">Create and Add</button>
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
  placeholder: { type: String, default: "Search people" },
  searchPlaceholder: { type: String, default: "Search people" },
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
