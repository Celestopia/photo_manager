<template>
  <AppDialog v-if="tagManager.visible" class="tag-manager-modal" dismiss-on-backdrop :busy="tagManager.saving" @close="closeTagManager">
      <template #header>
        <h3>Manage Tags</h3>
        <div class="tag-manager-header-actions">
          <button class="btn icon-btn modal-symbol-btn" data-tip="Create tag" :disabled="tagManager.saving" @click="openCreateTagMenu('manager')">+</button>
          <button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="Close" aria-label="Close" :disabled="tagManager.saving" @click="closeTagManager">×</button>
        </div>
      </template>
      <div class="tag-manager-controls"><input class="input tag-manager-search" v-model="tagManager.search" placeholder="Search tags or descriptions" /></div>
      <div class="tag-manager-list">
        <article class="tag-manager-item" v-for="tag in managerFilteredTags" :key="'manager_' + tag.TagId">
          <div class="tag-manager-item-main">
            <div class="tag-manager-item-title"><strong>{{ tag.Text }}</strong><span>{{ tag.UsageCount || 0 }} media items</span></div>
            <div v-if="tagManager.editingId === tag.TagId" class="registry-manager-edit">
              <label>Tag name</label><input autofocus class="input" v-model="tagManager.editText" :disabled="tagManager.saving" @keydown.enter.exact.prevent="saveTagEdit" @keydown.escape.prevent="cancelTagEdit" />
              <label>Description</label><textarea class="input tag-manager-description-input" v-model="tagManager.editDescription" placeholder="Optional" :disabled="tagManager.saving" @keydown.ctrl.enter.prevent="saveTagEdit"></textarea>
            </div>
            <p v-else>{{ tag.Description || 'No description' }}</p>
            <div class="tag-manager-error" v-if="tagManager.error && tagManager.editingId === tag.TagId">{{ tagManager.error }}</div>
          </div>
          <div class="tag-manager-actions" v-if="tagManager.editingId === tag.TagId"><button class="btn btn-primary" :disabled="tagManager.saving" @click="saveTagEdit">Save</button><button class="btn" :disabled="tagManager.saving" @click="cancelTagEdit">Cancel</button></div>
          <div class="tag-manager-actions" v-else><button class="btn" :disabled="tagManager.saving" @click="startTagEdit(tag)">Edit</button><button class="btn danger-text" :disabled="tagManager.saving" @click="deleteTagGlobally(tag)">Delete Globally</button></div>
        </article>
        <div class="tag-manager-empty" v-if="!managerFilteredTags.length">No matching tags</div>
      </div>
    </AppDialog>
  <AppDialog v-if="tagCreate.visible && tagCreate.target === 'manager'" class="registry-create-modal" dismiss-on-backdrop :busy="tagManager.saving" @close="closeCreateTagMenu">
      <template #header><h3>Create Tag</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="Close" aria-label="Close" @click="closeCreateTagMenu" :disabled="tagManager.saving">×</button></template>
      <div class="tag-manager-create-panel">
        <label>Tag name</label><input class="input" v-model="tagCreate.text" :disabled="tagManager.saving" />
        <label>Description (optional)</label><textarea class="input tag-create-description" v-model="tagCreate.description" :disabled="tagManager.saving"></textarea>
        <div class="tag-create-error" v-if="tagCreate.error">{{ tagCreate.error }}</div>
        <div class="tag-create-actions"><button class="btn" @click="closeCreateTagMenu" :disabled="tagManager.saving">Cancel</button><button class="btn btn-primary" @click="createTagAndSelect" :disabled="tagManager.saving">Create</button></div>
      </div>
    </AppDialog>
</template>

<script setup>
import AppDialog from "./AppDialog.vue";
import { inject } from "vue";
import { TAG_CONTEXT } from "../../context/renderer-contexts.js";
const context = inject(TAG_CONTEXT);
if (!context) throw new Error("TagManagerDialog requires TAG_CONTEXT");
const {
  tagManager, managerFilteredTags, tagCreate, openCreateTagMenu, closeTagManager,
  startTagEdit, saveTagEdit, cancelTagEdit,
  deleteTagGlobally, closeCreateTagMenu, createTagAndSelect,
} = context;
</script>
