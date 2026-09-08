<template>
  <div class="album-picker" @click.stop>
    <div class="album-control">
      <div class="album-input-wrap">
        <button
          type="button"
          class="input album-input registry-trigger"
          :class="{ 'is-placeholder': !selectedAlbumId }"
          :data-tip="selectedAlbumId ? getAlbumDescription(selectedAlbumId) : ''"
          @click="openAlbumDropdown(target)"
        ><span>{{ selectedAlbumTitle || placeholder }}</span></button>
        <button
          type="button"
          class="album-clear-btn"
          v-if="selectedAlbumId"
          data-tip="Remove current media from album"
          aria-label="Remove current media from album"
          @click.stop="clearAlbumForTarget(target)"
        >×</button>
        <RegistryOptionsMenu
          v-if="albumDropdown[target]"
          :search-text="albumSearch[target]"
          :search-placeholder="placeholder"
          :options="albumOptions"
          :selected-values="selectedAlbumId ? [selectedAlbumId] : []"
          id-key="AlbumId"
          label-key="Title"
          all-section-label="All Albums"
          empty-text="No matching albums"
          @update:search-text="albumSearch[target] = $event"
          @select="setAlbumForTarget(target, $event)"
          @close="closeAlbumDropdown(target)"
          @backspace-empty="selectedAlbumId && clearAlbumForTarget(target)"
        />
      </div>
      <div class="tag-actions">
        <button type="button" class="btn icon-btn tag-inline-btn" data-tip="Create album" @click.stop="openCreateAlbumMenu(target)">+</button>
        <button type="button" class="btn icon-btn tag-inline-btn" data-tip="Manage albums" @click.stop="openAlbumManager">
          <img class="icon" :src="ICONS.settings" alt="Manage albums" />
        </button>
      </div>
    </div>
    <div class="tag-create-popover" v-if="albumCreate.visible && albumCreate.target === target" @click.stop>
      <label>Album name</label>
      <input class="input" v-model="albumCreate.title" />
      <label>Description</label>
      <textarea class="input tag-create-description" v-model="albumCreate.description"></textarea>
      <div class="tag-create-error" v-if="albumCreate.error">{{ albumCreate.error }}</div>
      <div class="tag-create-actions">
        <button class="btn" @click="closeCreateAlbumMenu">Cancel</button>
        <button class="btn btn-primary" @click="createAlbumAndSelect">Create and Set</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, inject } from "vue";
import { ALBUM_CONTEXT } from "../context/renderer-contexts.js";
import RegistryOptionsMenu from "./RegistryOptionsMenu.vue";

const props = defineProps({
  target: { type: String, required: true },
  placeholder: { type: String, default: "Search albums" },
});

const app = inject(ALBUM_CONTEXT);
if (!app) {
  throw new Error("AlbumPicker must be used under App.vue provider");
}

const {
  ICONS,
  editDraft,
  batchEdit,
  albumSearch,
  albumDropdown,
  albumCreate,
  getAlbumOptions,
  getAlbumDescription,
  getAlbumTitle,
  openAlbumDropdown,
  closeAlbumDropdown,
  setAlbumForTarget,
  clearAlbumForTarget,
  openCreateAlbumMenu,
  closeCreateAlbumMenu,
  createAlbumAndSelect,
  openAlbumManager,
} = app;

const target = props.target;
const selectedAlbumId = computed(() => (props.target === "batch" ? batchEdit.albumId : editDraft.AlbumId));
const selectedAlbumTitle = computed(() => getAlbumTitle(selectedAlbumId.value));
const albumOptions = computed(() => getAlbumOptions(props.target));
</script>
