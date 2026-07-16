<template>
  <div class="tag-modal-backdrop" v-if="albumManager.visible" @click="closeAlbumManager">
    <section class="tag-manager-modal" @click.stop>
      <header class="tag-manager-header">
        <h3>相册管理</h3>
        <div class="tag-manager-header-actions">
          <button class="btn icon-btn modal-symbol-btn" data-tip="新建相册" :disabled="albumManager.saving" @click="openCreateAlbumMenu('manager')">+</button>
          <button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" :disabled="albumManager.saving" @click="closeAlbumManager">×</button>
        </div>
      </header>
      <div class="tag-manager-controls"><input class="input tag-manager-search" v-model="albumManager.search" placeholder="搜索相册或说明" /></div>
      <div class="tag-manager-list">
        <article class="tag-manager-item" v-for="album in managerFilteredAlbums" :key="'album_manager_' + album.AlbumId">
          <div class="tag-manager-item-main">
            <div class="tag-manager-item-title"><strong>{{ album.Title }}</strong><span>{{ album.UsageCount || 0 }} 个媒体</span></div>
            <div v-if="albumManager.editingId === album.AlbumId" class="registry-manager-edit">
              <label>相册名称</label><input autofocus class="input" v-model="albumManager.editTitle" :disabled="albumManager.saving" @keydown.enter.exact.prevent="saveAlbumEdit" @keydown.escape.prevent="cancelAlbumEdit" />
              <label>说明</label><textarea class="input tag-manager-description-input" v-model="albumManager.editDescription" :disabled="albumManager.saving" @keydown.ctrl.enter.prevent="saveAlbumEdit"></textarea>
            </div>
            <p v-else>{{ album.Description }}</p>
            <div class="tag-manager-error" v-if="albumManager.error && albumManager.editingId === album.AlbumId">{{ albumManager.error }}</div>
          </div>
          <div class="tag-manager-actions" v-if="albumManager.editingId === album.AlbumId"><button class="btn btn-primary" :disabled="albumManager.saving" @click="saveAlbumEdit">保存</button><button class="btn" :disabled="albumManager.saving" @click="cancelAlbumEdit">取消</button></div>
          <div class="tag-manager-actions" v-else><button class="btn" :disabled="albumManager.saving" @click="startAlbumEdit(album)">编辑</button><button class="btn danger-text" :disabled="albumManager.saving" @click="deleteAlbumGlobally(album)">全局删除</button></div>
        </article>
        <div class="tag-manager-empty" v-if="!managerFilteredAlbums.length">没有匹配的相册</div>
      </div>
    </section>
  </div>
  <div class="registry-create-backdrop" v-if="albumCreate.visible && albumCreate.target === 'manager'" @click="closeCreateAlbumMenu">
    <section class="registry-create-modal" @click.stop>
      <header class="tag-manager-header"><h3>新建相册</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" @click="closeCreateAlbumMenu">×</button></header>
      <div class="tag-manager-create-panel">
        <label>相册名称</label><input class="input" v-model="albumCreate.title" />
        <label>说明</label><textarea class="input tag-create-description" v-model="albumCreate.description"></textarea>
        <div class="tag-create-error" v-if="albumCreate.error">{{ albumCreate.error }}</div>
        <div class="tag-create-actions"><button class="btn" @click="closeCreateAlbumMenu">取消</button><button class="btn btn-primary" @click="createAlbumAndSelect">创建</button></div>
      </div>
    </section>
  </div>
</template>

<script setup>
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
