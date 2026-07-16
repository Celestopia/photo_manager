import { computed, reactive, ref, triggerRef } from "vue";

function normalizeText(value) { return String(value ?? "").trim(); }

/** Owns the ID-backed people registry, picker state, and management workflow. */
export function usePersonRegistry({
  api, filterOptions, query, editDraft, batchEdit, selectedItem, orderedItems,
  galleryGroups, gallerySettingsOpen, recentPeople, rememberRecentPerson, pruneRecentPeople,
  showToastMessage, closeOtherRegistryDropdowns, requestEdit, removeViewerPersonAt,
  removeBatchPersonAt, rebuildGalleryItemIndex, galleryItemIndex, queryGallery,
}) {
  const personRegistry = ref([]);
  const personSearch = reactive({ viewer: "", batch: "" });
  const personDropdown = reactive({ viewer: false, batch: false });
  const personCreate = reactive({ visible: false, target: "viewer", name: "", description: "", error: "" });
  const personManager = reactive({
    visible: false, search: "", editingId: "", editName: "", editDescription: "", saving: false, error: "",
  });

  const managerFilteredPeople = computed(() => {
    const keyword = personManager.search.trim();
    const source = [...personRegistry.value].sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN"));
    return keyword ? source.filter((person) => person.Name.includes(keyword) || person.Description.includes(keyword)) : source;
  });

  function applyPersonRegistry(people) {
    personRegistry.value = (Array.isArray(people) ? people : []).map((person) => ({
      PersonId: normalizeText(person?.PersonId),
      Name: normalizeText(person?.Name),
      Description: normalizeText(person?.Description),
      CreatedAt: person?.CreatedAt || "",
      UpdatedAt: person?.UpdatedAt || "",
      UsageCount: Number(person?.UsageCount || 0),
    })).filter((person) => person.PersonId && person.Name);
    filterOptions.people = personRegistry.value;
    const ids = personRegistry.value.map((person) => person.PersonId);
    pruneRecentPeople(ids);
    if (query.filters.person && !ids.includes(query.filters.person)) query.filters.person = "";
  }

  async function loadPeople() {
    const result = await api.listPeople?.();
    if (result?.ok) applyPersonRegistry(result.people);
  }
  function selectedPersonIdsForTarget(target) { return target === "batch" ? batchEdit.personIds : editDraft.PersonIds; }
  function getPersonDefinition(personId) { return personRegistry.value.find((person) => person.PersonId === personId) || null; }
  function getPersonDescription(personId) { return getPersonDefinition(personId)?.Description || ""; }
  function getPersonName(personId) { return getPersonDefinition(personId)?.Name || ""; }
  function getPersonCandidates(target) {
    const keyword = normalizeText(personSearch[target]);
    const selected = new Set(selectedPersonIdsForTarget(target));
    return personRegistry.value
      .filter((person) => !keyword || person.Name.includes(keyword) || person.Description.includes(keyword))
      .sort((a, b) => Number(selected.has(b.PersonId)) - Number(selected.has(a.PersonId)) || a.Name.localeCompare(b.Name, "zh-CN"));
  }
  function getPersonOptions(target) { return getPersonCandidates(target).slice(0, 50); }
  function getRecentPersonOptions(target) {
    const byId = new Map(getPersonCandidates(target).map((person) => [person.PersonId, person]));
    return recentPeople.value.map((id) => byId.get(id)).filter(Boolean).slice(0, 3);
  }

  function openPersonDropdown(target) {
    const shouldOpen = !personDropdown[target];
    closeOtherRegistryDropdowns?.();
    personDropdown[target] = shouldOpen;
  }
  function closePersonDropdown(target) { personDropdown[target] = false; }
  function closeAllPersonDropdowns() { personDropdown.viewer = false; personDropdown.batch = false; }

  function addPersonToTarget(target, personId) {
    const definition = getPersonDefinition(personId);
    if (!definition) return;
    const ids = selectedPersonIdsForTarget(target);
    if (ids.includes(personId)) showToastMessage(`人物“${definition.Name}”已存在，添加失败`);
    else {
      ids.push(personId);
      rememberRecentPerson(personId);
      if (target === "viewer") requestEdit("People");
    }
    personSearch[target] = "";
    closePersonDropdown(target);
  }
  function onPersonSearchKeydown(event, target) {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = getRecentPersonOptions(target)[0] || getPersonOptions(target)[0];
      if (first) addPersonToTarget(target, first.PersonId);
    } else if (event.key === "Escape") closePersonDropdown(target);
    else if (event.key === "Backspace" && !personSearch[target]) {
      event.preventDefault();
      if (target === "batch") removeBatchPersonAt(batchEdit.personIds.length - 1);
      else removeViewerPersonAt(editDraft.PersonIds.length - 1);
    }
  }

  function openCreatePersonMenu(target) {
    closeOtherRegistryDropdowns?.();
    Object.assign(personCreate, {
      visible: true, target,
      name: target === "manager" ? "" : normalizeText(personSearch[target]),
      description: "", error: "",
    });
    if (target !== "manager") closePersonDropdown(target);
  }
  function closeCreatePersonMenu() { Object.assign(personCreate, { visible: false, name: "", description: "", error: "" }); }
  async function createPersonAndSelect() {
    const name = normalizeText(personCreate.name);
    if (!name) { personCreate.error = "人物姓名不能为空"; return; }
    const result = await api.createPerson({ name, description: normalizeText(personCreate.description) });
    if (!result?.ok) { personCreate.error = result?.error || "创建人物失败"; return; }
    applyPersonRegistry(result.people);
    const target = personCreate.target;
    if (target === "manager") showToastMessage(`已创建人物“${result.person.Name}”`);
    else addPersonToTarget(target, result.person.PersonId);
    closeCreatePersonMenu();
  }

  async function openPersonManager() {
    gallerySettingsOpen.value = false;
    closeOtherRegistryDropdowns?.();
    await loadPeople();
    personManager.visible = true;
    personManager.error = "";
  }
  function closePersonManager() {
    if (personManager.saving) return;
    if (personCreate.target === "manager") closeCreatePersonMenu();
    Object.assign(personManager, {
      visible: false, search: "", editingId: "", editName: "", editDescription: "", saving: false, error: "",
    });
  }
  function startPersonEdit(person) {
    if (personManager.saving) return;
    Object.assign(personManager, {
      editingId: person.PersonId, editName: person.Name || "", editDescription: person.Description || "", saving: false, error: "",
    });
  }
  function cancelPersonEdit() {
    if (personManager.saving) return;
    Object.assign(personManager, { editingId: "", editName: "", editDescription: "", saving: false, error: "" });
  }
  async function savePersonEdit() {
    const personId = personManager.editingId;
    const name = normalizeText(personManager.editName);
    if (!personId) { personManager.error = "人物不存在"; return; }
    if (!name) { personManager.error = "人物姓名不能为空"; return; }
    const previousName = getPersonName(personId);
    personManager.saving = true;
    let result;
    try {
      result = await api.updatePerson({ personId, name, description: normalizeText(personManager.editDescription) });
    } catch {
      personManager.saving = false;
      personManager.error = "保存人物失败";
      return;
    }
    personManager.saving = false;
    if (!result?.ok) { personManager.error = result?.error || "保存人物失败"; return; }
    applyPersonRegistry(result.people);
    cancelPersonEdit();
    showToastMessage(previousName === name ? "人物已更新" : `已将人物“${previousName}”重命名为“${name}”`);
  }

  function stripPersonFromItem(item, personId) {
    const ids = Array.isArray(item?.Customization?.PersonIds) ? item.Customization.PersonIds : [];
    return ids.includes(personId)
      ? { ...item, Customization: { ...(item.Customization || {}), PersonIds: ids.filter((id) => id !== personId) } }
      : item;
  }
  function syncDeletedPersonLocally(personId) {
    if (selectedItem.value) selectedItem.value = stripPersonFromItem(selectedItem.value, personId);
    editDraft.PersonIds = editDraft.PersonIds.filter((id) => id !== personId);
    batchEdit.personIds = batchEdit.personIds.filter((id) => id !== personId);
    orderedItems.value = orderedItems.value.map((item) => stripPersonFromItem(item, personId));
    rebuildGalleryItemIndex();
    for (const group of galleryGroups.value) group.items = group.items.map((item) => galleryItemIndex.get(item.MediaId) || item);
    triggerRef(galleryGroups);
  }
  async function deletePersonGlobally(person) {
    const usage = Number(person?.UsageCount || 0);
    if (!window.confirm(`确定全局删除人物“${person.Name}”？这会从 ${usage} 个媒体中移除。`)) return;
    const result = await api.deletePersonGlobally({ personId: person.PersonId });
    if (!result?.ok) { showToastMessage(`删除人物失败：${result?.error || "未知错误"}`); return; }
    applyPersonRegistry(result.people);
    syncDeletedPersonLocally(person.PersonId);
    if (query.filters.person === person.PersonId) { query.filters.person = ""; await queryGallery(); }
    showToastMessage(`已全局删除人物“${person.Name}”`);
  }

  function resetPersonState() {
    personRegistry.value = [];
    Object.assign(personSearch, { viewer: "", batch: "" });
    closeAllPersonDropdowns(); closeCreatePersonMenu();
    Object.assign(personManager, {
      visible: false, search: "", editingId: "", editName: "", editDescription: "", saving: false, error: "",
    });
  }

  return {
    personRegistry, personSearch, personDropdown, personCreate, personManager,
    managerFilteredPeople, loadPeople, getPersonOptions, getRecentPersonOptions,
    getPersonDescription, getPersonName, openPersonDropdown, closePersonDropdown,
    closeAllPersonDropdowns, addPersonToTarget, onPersonSearchKeydown,
    openCreatePersonMenu, closeCreatePersonMenu, createPersonAndSelect,
    openPersonManager, closePersonManager, startPersonEdit,
    cancelPersonEdit, savePersonEdit, deletePersonGlobally, resetPersonState,
  };
}
