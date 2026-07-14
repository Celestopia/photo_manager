<template>
  <div class="tag-modal-backdrop" v-if="personManager.visible" @click="closePersonManager">
    <section class="tag-manager-modal" @click.stop>
      <header class="tag-manager-header">
        <h3>人物管理</h3>
        <div class="tag-manager-header-actions">
          <button class="btn icon-btn modal-symbol-btn" data-tip="新建人物" @click="openCreatePersonMenu('manager')">+</button>
          <button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" @click="closePersonManager">×</button>
        </div>
      </header>
      <div class="tag-manager-controls"><input class="input tag-manager-search" v-model="personManager.search" placeholder="搜索姓名或说明" /></div>
      <div class="tag-manager-list">
        <article class="tag-manager-item" v-for="person in managerFilteredPeople" :key="'person_manager_' + person.Name">
          <div class="tag-manager-item-main">
            <div class="tag-manager-item-title"><strong>{{ person.Name }}</strong><span>{{ person.UsageCount || 0 }} 个媒体</span></div>
            <textarea v-if="personManager.editingName === person.Name" class="input tag-manager-description-input" v-model="personManager.editDescription" placeholder="可留空"></textarea>
            <p v-else>{{ person.Description || '无说明' }}</p>
            <div class="tag-manager-error" v-if="personManager.error && personManager.editingName === person.Name">{{ personManager.error }}</div>
          </div>
          <div class="tag-manager-actions" v-if="personManager.editingName === person.Name"><button class="btn btn-primary" @click="savePersonDescription">保存</button><button class="btn" @click="cancelPersonDescriptionEdit">取消</button></div>
          <div class="tag-manager-actions" v-else><button class="btn" @click="startPersonDescriptionEdit(person)">编辑说明</button><button class="btn danger-text" @click="deletePersonGlobally(person)">全局删除</button></div>
        </article>
        <div class="tag-manager-empty" v-if="!managerFilteredPeople.length">没有匹配的人物</div>
      </div>
    </section>
  </div>
  <div class="registry-create-backdrop" v-if="personCreate.visible && personCreate.target === 'manager'" @click="closeCreatePersonMenu">
    <section class="registry-create-modal" @click.stop>
      <header class="tag-manager-header"><h3>新建人物</h3><button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" @click="closeCreatePersonMenu">×</button></header>
      <div class="tag-manager-create-panel">
        <label>人物姓名</label><input class="input" v-model="personCreate.name" />
        <label>说明（可留空）</label><textarea class="input tag-create-description" v-model="personCreate.description"></textarea>
        <div class="tag-create-error" v-if="personCreate.error">{{ personCreate.error }}</div>
        <div class="tag-create-actions"><button class="btn" @click="closeCreatePersonMenu">取消</button><button class="btn btn-primary" @click="createPersonAndSelect">创建</button></div>
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
  closePersonManager, startPersonDescriptionEdit, savePersonDescription,
  cancelPersonDescriptionEdit, deletePersonGlobally, closeCreatePersonMenu,
  createPersonAndSelect,
} = context;
</script>
