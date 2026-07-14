import { computed, reactive, ref, triggerRef } from "vue";

function normalizePersonName(value) {
  return String(value ?? "").trim();
}

/** Owns the controlled people registry, picker state, and person-management workflow. */
export function usePersonRegistry({
  api,
  filterOptions,
  query,
  editDraft,
  batchEdit,
  selectedItem,
  orderedItems,
  galleryGroups,
  gallerySettingsOpen,
  recentPeople,
  rememberRecentPerson,
  pruneRecentPeople,
  showToastMessage,
  closeOtherRegistryDropdowns,
  requestEdit,
  removeViewerPersonAt,
  removeBatchPersonAt,
  rebuildGalleryItemIndex,
  galleryItemIndex,
  queryGallery,
}) {
  const personRegistry = ref([]);
  const personSearch = reactive({ viewer: "", batch: "" });
  const personDropdown = reactive({ viewer: false, batch: false });
  const personCreate = reactive({ visible: false, target: "viewer", name: "", description: "", error: "" });
  const personManager = reactive({ visible: false, search: "", editingName: "", editDescription: "", error: "" });

  const managerFilteredPeople = computed(() => {
    const keyword = personManager.search.trim();
    const source = [...personRegistry.value].sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN"));
    if (!keyword) return source;
    return source.filter((person) => person.Name.includes(keyword) || (person.Description || "").includes(keyword));
  });

  function applyPersonRegistry(people) {
    personRegistry.value = (Array.isArray(people) ? people : [])
      .map((person) => ({
        Name: normalizePersonName(person?.Name),
        Description: normalizePersonName(person?.Description),
        CreatedAt: person?.CreatedAt || "",
        UpdatedAt: person?.UpdatedAt || "",
        UsageCount: Number(person?.UsageCount || 0),
      }))
      .filter((person) => person.Name);
    filterOptions.people = personRegistry.value.map((person) => person.Name);
    pruneRecentPeople(filterOptions.people);
    if (query.filters.person && !filterOptions.people.includes(query.filters.person)) query.filters.person = "";
  }

  async function loadPeople() {
    if (typeof api.listPeople !== "function") return;
    const result = await api.listPeople();
    if (result?.ok) applyPersonRegistry(result.people);
  }

  function selectedPeopleForTarget(target) {
    return target === "batch" ? batchEdit.people : editDraft.People;
  }

  function getPersonCandidates(target) {
    const keyword = normalizePersonName(personSearch[target]);
    const selected = new Set(selectedPeopleForTarget(target));
    return personRegistry.value
      .filter((person) => !keyword || person.Name.includes(keyword) || (person.Description || "").includes(keyword))
      .sort((a, b) => Number(selected.has(b.Name)) - Number(selected.has(a.Name)) || a.Name.localeCompare(b.Name, "zh-CN"));
  }

  function getPersonOptions(target) { return getPersonCandidates(target).slice(0, 50); }

  function getRecentPersonOptions(target) {
    const byName = new Map(getPersonCandidates(target).map((person) => [person.Name, person]));
    return recentPeople.value.map((name) => byName.get(name)).filter(Boolean).slice(0, 3);
  }

  function getPersonDescription(personName) {
    return personRegistry.value.find((person) => person.Name === personName)?.Description || "";
  }

  function openPersonDropdown(target) {
    const shouldOpen = !personDropdown[target];
    closeOtherRegistryDropdowns?.();
    personDropdown[target] = shouldOpen;
  }

  function closePersonDropdown(target) { personDropdown[target] = false; }

  function closeAllPersonDropdowns() {
    personDropdown.viewer = false;
    personDropdown.batch = false;
  }

  function addPersonToTarget(target, rawName) {
    const name = normalizePersonName(rawName);
    if (!name) return;
    const people = selectedPeopleForTarget(target);
    if (people.includes(name)) {
      showToastMessage(`人物“${name}”已存在，添加失败`);
      personSearch[target] = "";
      closePersonDropdown(target);
      return;
    }
    people.push(name);
    rememberRecentPerson(name);
    personSearch[target] = "";
    closePersonDropdown(target);
    if (target === "viewer") requestEdit("People");
  }

  function onPersonSearchKeydown(event, target) {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = getRecentPersonOptions(target)[0] || getPersonOptions(target)[0];
      if (first) addPersonToTarget(target, first.Name);
      return;
    }
    if (event.key === "Escape") {
      closePersonDropdown(target);
      return;
    }
    if (event.key === "Backspace" && !personSearch[target]) {
      event.preventDefault();
      if (target === "batch") removeBatchPersonAt(batchEdit.people.length - 1);
      else removeViewerPersonAt(editDraft.People.length - 1);
    }
  }

  function openCreatePersonMenu(target) {
    closeOtherRegistryDropdowns?.();
    Object.assign(personCreate, {
      visible: true,
      target,
      name: target === "manager" ? "" : normalizePersonName(personSearch[target]),
      description: "",
      error: "",
    });
    if (target !== "manager") closePersonDropdown(target);
  }

  function closeCreatePersonMenu() {
    Object.assign(personCreate, { visible: false, name: "", description: "", error: "" });
  }

  async function createPersonAndSelect() {
    const name = normalizePersonName(personCreate.name);
    const description = normalizePersonName(personCreate.description);
    if (!name) {
      personCreate.error = "人物姓名不能为空";
      return;
    }
    const result = await api.createPerson({ name, description });
    if (!result?.ok) {
      personCreate.error = result?.error || "创建人物失败";
      return;
    }
    applyPersonRegistry(result.people);
    const target = personCreate.target;
    if (target === "manager") showToastMessage(`已创建人物“${result.person.Name}”`);
    else addPersonToTarget(target, result.person.Name);
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
    if (personCreate.target === "manager") closeCreatePersonMenu();
    Object.assign(personManager, { visible: false, search: "", editingName: "", editDescription: "", error: "" });
  }

  function startPersonDescriptionEdit(person) {
    Object.assign(personManager, { editingName: person.Name, editDescription: person.Description || "", error: "" });
  }

  function cancelPersonDescriptionEdit() {
    Object.assign(personManager, { editingName: "", editDescription: "", error: "" });
  }

  async function savePersonDescription() {
    const name = personManager.editingName;
    const description = normalizePersonName(personManager.editDescription);
    if (!name) {
      personManager.error = "人物姓名不能为空";
      return;
    }
    const result = await api.updatePersonDescription({ name, description });
    if (!result?.ok) {
      personManager.error = result?.error || "保存说明失败";
      return;
    }
    applyPersonRegistry(result.people);
    cancelPersonDescriptionEdit();
    showToastMessage("人物说明已更新");
  }

  function stripPersonFromItem(item, personName) {
    const people = Array.isArray(item?.Customization?.People) ? item.Customization.People : [];
    if (!people.includes(personName)) return item;
    return { ...item, Customization: { ...(item.Customization || {}), People: people.filter((person) => person !== personName) } };
  }

  function syncDeletedPersonLocally(personName) {
    if (selectedItem.value) selectedItem.value = stripPersonFromItem(selectedItem.value, personName);
    editDraft.People = editDraft.People.filter((person) => person !== personName);
    batchEdit.people = batchEdit.people.filter((person) => person !== personName);
    orderedItems.value = orderedItems.value.map((item) => stripPersonFromItem(item, personName));
    rebuildGalleryItemIndex();
    for (const group of galleryGroups.value) {
      group.items = group.items.map((item) => galleryItemIndex.get(item.FilePath) || item);
    }
    triggerRef(galleryGroups);
  }

  async function deletePersonGlobally(person) {
    const usage = Number(person?.UsageCount || 0);
    if (!window.confirm(`确定全局删除人物“${person.Name}”？这会从 ${usage} 个媒体中移除。`)) return;
    const result = await api.deletePersonGlobally({ name: person.Name });
    if (!result?.ok) {
      showToastMessage(`删除人物失败：${result?.error || "未知错误"}`);
      return;
    }
    applyPersonRegistry(result.people);
    syncDeletedPersonLocally(person.Name);
    if (query.filters.person === person.Name) {
      query.filters.person = "";
      await queryGallery();
    }
    showToastMessage(`已全局删除人物“${person.Name}”`);
  }

  function resetPersonState() {
    personRegistry.value = [];
    Object.assign(personSearch, { viewer: "", batch: "" });
    closeAllPersonDropdowns();
    closeCreatePersonMenu();
    Object.assign(personManager, { visible: false, search: "", editingName: "", editDescription: "", error: "" });
  }

  return {
    personRegistry,
    personSearch,
    personDropdown,
    personCreate,
    personManager,
    managerFilteredPeople,
    loadPeople,
    getPersonOptions,
    getRecentPersonOptions,
    getPersonDescription,
    openPersonDropdown,
    closePersonDropdown,
    closeAllPersonDropdowns,
    addPersonToTarget,
    onPersonSearchKeydown,
    openCreatePersonMenu,
    closeCreatePersonMenu,
    createPersonAndSelect,
    openPersonManager,
    closePersonManager,
    startPersonDescriptionEdit,
    cancelPersonDescriptionEdit,
    savePersonDescription,
    deletePersonGlobally,
    resetPersonState,
  };
}
