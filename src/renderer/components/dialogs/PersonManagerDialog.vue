<template>
  <div class="tag-modal-backdrop" v-if="personManager.visible" @click="closePersonManager">
    <section class="tag-manager-modal" @click.stop>
      <header class="tag-manager-header">
        <h3>人物管理</h3>
        <div class="tag-manager-header-actions">
          <button class="btn icon-btn modal-symbol-btn" data-tip="新建人物" :disabled="personManager.saving" @click="openCreatePersonMenu('manager')">+</button>
          <button class="btn icon-btn modal-symbol-btn modal-close-btn" data-tip="关闭" aria-label="关闭" :disabled="personManager.saving" @click="closePersonManager">×</button>
        </div>
      </header>
      <div class="tag-manager-controls"><input class="input tag-manager-search" v-model="personManager.search" placeholder="搜索姓名或说明" /></div>
      <div class="tag-manager-list">
        <article class="tag-manager-item" v-for="person in managerFilteredPeople" :key="'person_manager_' + person.PersonId">
          <div class="tag-manager-item-main">
            <div class="tag-manager-item-title"><strong>{{ person.Name }}</strong><span>{{ person.UsageCount || 0 }} 个媒体</span></div>
            <div v-if="personManager.editingId === person.PersonId" class="registry-manager-edit">
              <label>人物姓名</label><input autofocus class="input" v-model="personManager.editName" :disabled="personManager.saving" @keydown.enter.exact.prevent="savePersonEdit" @keydown.escape.prevent="cancelPersonEdit" />
              <label>说明</label><textarea class="input tag-manager-description-input" v-model="personManager.editDescription" placeholder="可留空" :disabled="personManager.saving" @keydown.ctrl.enter.prevent="savePersonEdit"></textarea>
            </div>
            <p v-else>{{ person.Description || '无说明' }}</p>
            <div class="tag-manager-error" v-if="personManager.error && personManager.editingId === person.PersonId">{{ personManager.error }}</div>
          </div>
          <div class="tag-manager-actions" v-if="personManager.editingId === person.PersonId"><button class="btn btn-primary" :disabled="personManager.saving" @click="savePersonEdit">保存</button><button class="btn" :disabled="personManager.saving" @click="cancelPersonEdit">取消</button></div>
          <div class="tag-manager-actions" v-else><button class="btn" :disabled="personManager.saving" @click="startPersonEdit(person)">编辑</button><button class="btn danger-text" :disabled="personManager.saving" @click="deletePersonGlobally(person)">全局删除</button></div>
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
  closePersonManager, startPersonEdit, savePersonEdit,
  cancelPersonEdit, deletePersonGlobally, closeCreatePersonMenu,
  createPersonAndSelect,
} = context;
</script>
