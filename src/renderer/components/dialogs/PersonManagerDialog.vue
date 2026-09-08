<template>
  <div class="tag-modal-backdrop" v-if="personManager.visible" @click="closePersonManager">
    <section class="tag-manager-modal" @click.stop>
      <header class="tag-manager-header">
        <h3>Manage People</h3>
        <div class="tag-manager-header-actions">
          <button class="btn icon-btn modal-symbol-btn" data-tip="Create person" :disabled="personManager.saving" @click="openCreatePersonMenu('manager')">+</button>
          <button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="Close" aria-label="Close" :disabled="personManager.saving" @click="closePersonManager">×</button>
        </div>
      </header>
      <div class="tag-manager-controls"><input class="input tag-manager-search" v-model="personManager.search" placeholder="Search names or descriptions" /></div>
      <div class="tag-manager-list">
        <article class="tag-manager-item" v-for="person in managerFilteredPeople" :key="'person_manager_' + person.PersonId">
          <div class="tag-manager-item-main">
            <div class="tag-manager-item-title"><strong>{{ person.Name }}</strong><span>{{ person.UsageCount || 0 }} media items</span></div>
            <div v-if="personManager.editingId === person.PersonId" class="registry-manager-edit">
              <label>Person name</label><input autofocus class="input" v-model="personManager.editName" :disabled="personManager.saving" @keydown.enter.exact.prevent="savePersonEdit" @keydown.escape.prevent="cancelPersonEdit" />
              <label>Description</label><textarea class="input tag-manager-description-input" v-model="personManager.editDescription" placeholder="Optional" :disabled="personManager.saving" @keydown.ctrl.enter.prevent="savePersonEdit"></textarea>
            </div>
            <p v-else>{{ person.Description || 'No description' }}</p>
            <div class="tag-manager-error" v-if="personManager.error && personManager.editingId === person.PersonId">{{ personManager.error }}</div>
          </div>
          <div class="tag-manager-actions" v-if="personManager.editingId === person.PersonId"><button class="btn btn-primary" :disabled="personManager.saving" @click="savePersonEdit">Save</button><button class="btn" :disabled="personManager.saving" @click="cancelPersonEdit">Cancel</button></div>
          <div class="tag-manager-actions" v-else><button class="btn" :disabled="personManager.saving" @click="startPersonEdit(person)">Edit</button><button class="btn danger-text" :disabled="personManager.saving" @click="deletePersonGlobally(person)">Delete Globally</button></div>
        </article>
        <div class="tag-manager-empty" v-if="!managerFilteredPeople.length">No matching people</div>
      </div>
    </section>
  </div>
  <div class="registry-create-backdrop" v-if="personCreate.visible && personCreate.target === 'manager'" @click="closeCreatePersonMenu">
    <section class="registry-create-modal" @click.stop>
      <header class="tag-manager-header"><h3>Create Person</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="Close" aria-label="Close" @click="closeCreatePersonMenu">×</button></header>
      <div class="tag-manager-create-panel">
        <label>Person name</label><input class="input" v-model="personCreate.name" />
        <label>Description (optional)</label><textarea class="input tag-create-description" v-model="personCreate.description"></textarea>
        <div class="tag-create-error" v-if="personCreate.error">{{ personCreate.error }}</div>
        <div class="tag-create-actions"><button class="btn" @click="closeCreatePersonMenu">Cancel</button><button class="btn btn-primary" @click="createPersonAndSelect">Create</button></div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { inject } from "vue";
import { PERSON_CONTEXT } from "../../context/renderer-contexts.js";
const context = inject(PERSON_CONTEXT);
if (!context) throw new Error("PersonManagerDialog requires PERSON_CONTEXT");
const {
  personManager, managerFilteredPeople, personCreate, openCreatePersonMenu,
  closePersonManager, startPersonEdit, savePersonEdit,
  cancelPersonEdit, deletePersonGlobally, closeCreatePersonMenu,
  createPersonAndSelect,
} = context;
</script>
