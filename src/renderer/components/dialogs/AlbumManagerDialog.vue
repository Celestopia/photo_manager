<template>
  <AppDialog v-if="albumManager.visible" class="tag-manager-modal" dismiss-on-backdrop :busy="albumManager.saving" @close="closeAlbumManager">
      <template #header>
        <h3>Manage Albums</h3>
        <div class="tag-manager-header-actions">
          <button class="btn icon-btn modal-symbol-btn" data-tip="Create album" :disabled="albumManager.saving" @click="openCreateAlbumMenu('manager')">+</button>
          <button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="Close" aria-label="Close" :disabled="albumManager.saving" @click="closeAlbumManager">×</button>
        </div>
      </template>
      <div class="tag-manager-controls"><input class="input tag-manager-search" v-model="albumManager.search" placeholder="Search albums or descriptions" /></div>
      <div class="tag-manager-list">
        <article class="tag-manager-item" v-for="album in managerFilteredAlbums" :key="'album_manager_' + album.AlbumId">
          <div class="tag-manager-item-main">
            <div class="tag-manager-item-title"><strong>{{ album.Title }}</strong><span>{{ album.UsageCount || 0 }} media items</span></div>
            <div v-if="albumManager.editingId === album.AlbumId" class="registry-manager-edit">
              <RegistryNameFields label="Album name" v-model:name="albumManager.editTitle" v-model:description="albumManager.editDescription" :disabled="albumManager.saving" required-description editing @save="saveAlbumEdit" @cancel="cancelAlbumEdit" />
            </div>
            <p v-else>{{ album.Description }}</p>
            <div class="tag-manager-error" v-if="albumManager.error && albumManager.editingId === album.AlbumId">{{ albumManager.error }}</div>
          </div>
          <div class="tag-manager-actions" v-if="albumManager.editingId === album.AlbumId"><button class="btn btn-primary" :disabled="albumManager.saving" @click="saveAlbumEdit">Save</button><button class="btn" :disabled="albumManager.saving" @click="cancelAlbumEdit">Cancel</button></div>
          <div class="tag-manager-actions" v-else><button class="btn" :disabled="albumManager.saving" @click="startAlbumEdit(album)">Edit</button><button class="btn danger-text" :disabled="albumManager.saving" @click="deleteAlbumGlobally(album)">Delete Globally</button></div>
        </article>
        <div class="tag-manager-empty" v-if="!managerFilteredAlbums.length">No matching albums</div>
      </div>
    </AppDialog>
  <AppDialog v-if="albumCreate.visible && albumCreate.target === 'manager'" class="registry-create-modal" dismiss-on-backdrop :busy="albumManager.saving" @close="closeCreateAlbumMenu">
      <template #header><h3>Create Album</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="Close" aria-label="Close" @click="closeCreateAlbumMenu" :disabled="albumManager.saving">×</button></template>
      <div class="tag-manager-create-panel">
        <RegistryNameFields label="Album name" v-model:name="albumCreate.title" v-model:description="albumCreate.description" :disabled="albumManager.saving" required-description />
        <div class="tag-create-error" v-if="albumCreate.error">{{ albumCreate.error }}</div>
        <div class="tag-create-actions"><button class="btn" @click="closeCreateAlbumMenu" :disabled="albumManager.saving">Cancel</button><button class="btn btn-primary" @click="createAlbumAndSelect" :disabled="albumManager.saving">Create</button></div>
      </div>
    </AppDialog>
</template>

<script setup>
import RegistryNameFields from "../RegistryNameFields.vue";
import AppDialog from "./AppDialog.vue";
import { inject } from "vue";
import { ALBUM_CONTEXT } from "../../context/renderer-contexts.js";
const context = inject(ALBUM_CONTEXT);
if (!context) throw new Error("AlbumManagerDialog requires ALBUM_CONTEXT");
const {
  albumManager, managerFilteredAlbums, albumCreate, openCreateAlbumMenu,
  closeAlbumManager, startAlbumEdit, saveAlbumEdit,
  cancelAlbumEdit, deleteAlbumGlobally, closeCreateAlbumMenu,
  createAlbumAndSelect,
} = context;
</script>
