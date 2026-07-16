<template>
  <div class="tag-modal-backdrop" v-if="tagManager.visible" @click="closeTagManager">
    <section class="tag-manager-modal" @click.stop>
      <header class="tag-manager-header">
        <h3>标签管理</h3>
        <div class="tag-manager-header-actions">
          <button class="btn icon-btn modal-symbol-btn" data-tip="新建标签" :disabled="tagManager.saving" @click="openCreateTagMenu('manager')">+</button>
          <button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" :disabled="tagManager.saving" @click="closeTagManager">×</button>
        </div>
      </header>
      <div class="tag-manager-controls"><input class="input tag-manager-search" v-model="tagManager.search" placeholder="搜索标签或说明" /></div>
      <div class="tag-manager-list">
        <article class="tag-manager-item" v-for="tag in managerFilteredTags" :key="'manager_' + tag.TagId">
          <div class="tag-manager-item-main">
            <div class="tag-manager-item-title"><strong>{{ tag.Text }}</strong><span>{{ tag.UsageCount || 0 }} 个媒体</span></div>
            <div v-if="tagManager.editingId === tag.TagId" class="registry-manager-edit">
              <label>标签名称</label><input autofocus class="input" v-model="tagManager.editText" :disabled="tagManager.saving" @keydown.enter.exact.prevent="saveTagEdit" @keydown.escape.prevent="cancelTagEdit" />
              <label>说明</label><textarea class="input tag-manager-description-input" v-model="tagManager.editDescription" placeholder="可留空" :disabled="tagManager.saving" @keydown.ctrl.enter.prevent="saveTagEdit"></textarea>
            </div>
            <p v-else>{{ tag.Description || '无说明' }}</p>
            <div class="tag-manager-error" v-if="tagManager.error && tagManager.editingId === tag.TagId">{{ tagManager.error }}</div>
          </div>
          <div class="tag-manager-actions" v-if="tagManager.editingId === tag.TagId"><button class="btn btn-primary" :disabled="tagManager.saving" @click="saveTagEdit">保存</button><button class="btn" :disabled="tagManager.saving" @click="cancelTagEdit">取消</button></div>
          <div class="tag-manager-actions" v-else><button class="btn" :disabled="tagManager.saving" @click="startTagEdit(tag)">编辑</button><button class="btn danger-text" :disabled="tagManager.saving" @click="deleteTagGlobally(tag)">全局删除</button></div>
        </article>
        <div class="tag-manager-empty" v-if="!managerFilteredTags.length">没有匹配的标签</div>
      </div>
    </section>
  </div>
  <div class="registry-create-backdrop" v-if="tagCreate.visible && tagCreate.target === 'manager'" @click="closeCreateTagMenu">
    <section class="registry-create-modal" @click.stop>
      <header class="tag-manager-header"><h3>新建标签</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" @click="closeCreateTagMenu">×</button></header>
      <div class="tag-manager-create-panel">
        <label>标签名称</label><input class="input" v-model="tagCreate.text" />
        <label>说明（可留空）</label><textarea class="input tag-create-description" v-model="tagCreate.description"></textarea>
        <div class="tag-create-error" v-if="tagCreate.error">{{ tagCreate.error }}</div>
        <div class="tag-create-actions"><button class="btn" @click="closeCreateTagMenu">取消</button><button class="btn btn-primary" @click="createTagAndSelect">创建</button></div>
      </div>
    </section>
  </div>
</template>

<script setup>
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
