<template>
  <div class="album-picker" @click.stop>
    <div class="album-control">
      <div class="album-input-wrap">
        <input
          class="input album-input"
          v-model="albumInputText"
          :data-tip="selectedAlbum ? getAlbumDescription(selectedAlbum) : ''"
          @focus="openAlbumDropdown(target)"
          @input="openAlbumDropdown(target)"
          @keydown="onAlbumSearchKeydown($event, target)"
          :placeholder="placeholder"
          autocomplete="off"
        />
        <button
          type="button"
          class="album-clear-btn"
          v-if="selectedAlbum"
          data-tip="将当前图片移出相册"
          aria-label="将当前图片移出相册"
          @click.stop="clearAlbumForTarget(target)"
        >×</button>
        <div class="tag-dropdown" v-if="albumDropdown[target]">
          <button
            v-for="album in albumOptions"
            :key="target + '_album_option_' + album.Title"
            type="button"
            class="tag-option"
            :data-tip="album.Description"
            @mousedown.prevent="setAlbumForTarget(target, album.Title)"
          >
            <span>{{ album.Title }}</span>
          </button>
          <div class="tag-option-empty" v-if="!albumOptions.length">没有匹配的相册</div>
        </div>
      </div>
      <div class="tag-actions">
        <button type="button" class="btn icon-btn tag-inline-btn" data-tip="新建相册" @click.stop="openCreateAlbumMenu(target)">+</button>
        <button type="button" class="btn icon-btn tag-inline-btn" data-tip="相册管理" @click.stop="openAlbumManager">
          <img class="icon" :src="ICONS.settings" alt="相册管理" />
        </button>
      </div>
    </div>
    <div class="tag-create-popover" v-if="albumCreate.visible && albumCreate.target === target" @click.stop>
      <label>相册名称</label>
      <input class="input" v-model="albumCreate.title" />
      <label>说明</label>
      <textarea class="input tag-create-description" v-model="albumCreate.description"></textarea>
      <div class="tag-create-error" v-if="albumCreate.error">{{ albumCreate.error }}</div>
      <div class="tag-create-actions">
        <button class="btn" @click="closeCreateAlbumMenu">取消</button>
        <button class="btn btn-primary" @click="createAlbumAndSelect">创建并设置</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, inject } from "vue";

const props = defineProps({
  target: { type: String, required: true },
  placeholder: { type: String, default: "搜索相册" },
});

const app = inject("appContext");
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
  openAlbumDropdown,
  setAlbumForTarget,
  clearAlbumForTarget,
  onAlbumSearchKeydown,
  openCreateAlbumMenu,
  closeCreateAlbumMenu,
  createAlbumAndSelect,
  openAlbumManager,
} = app;

const target = props.target;
const selectedAlbum = computed(() => (props.target === "batch" ? batchEdit.album : editDraft.Album));
const albumInputText = computed({
  get() {
    return albumDropdown[props.target] ? albumSearch[props.target] : selectedAlbum.value;
  },
  set(value) {
    albumSearch[props.target] = value;
  },
});
const albumOptions = computed(() => getAlbumOptions(props.target));
</script>
