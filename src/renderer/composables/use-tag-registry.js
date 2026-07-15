import { computed, reactive, ref, triggerRef } from "vue";

function normalizeText(value) {
  return String(value ?? "").trim();
}

/** Owns the ID-backed tag registry, picker state, and tag-management workflow. */
export function useTagRegistry({
  api, filterOptions, query, editDraft, batchEdit, selectedItem, orderedItems,
  galleryGroups, gallerySettingsOpen, recentTags, rememberRecentTag, pruneRecentTags,
  showToastMessage, closeOtherRegistryDropdowns, requestEdit, removeViewerTagAt,
  removeBatchTagAt, rebuildGalleryItemIndex, galleryItemIndex, queryGallery,
}) {
  const tagRegistry = ref([]);
  const tagSearch = reactive({ viewer: "", batch: "" });
  const tagDropdown = reactive({ viewer: false, batch: false });
  const tagCreate = reactive({ visible: false, target: "viewer", text: "", description: "", error: "" });
  const tagManager = reactive({ visible: false, search: "", editingId: "", editDescription: "", error: "" });

  const managerFilteredTags = computed(() => {
    const keyword = tagManager.search.trim();
    const source = [...tagRegistry.value].sort((a, b) => a.Text.localeCompare(b.Text, "zh-CN"));
    return keyword ? source.filter((tag) => tag.Text.includes(keyword) || tag.Description.includes(keyword)) : source;
  });

  function applyTagRegistry(tags) {
    tagRegistry.value = (Array.isArray(tags) ? tags : []).map((tag) => ({
      TagId: normalizeText(tag?.TagId),
      Text: normalizeText(tag?.Text),
      Description: normalizeText(tag?.Description),
      CreatedAt: tag?.CreatedAt || "",
      UpdatedAt: tag?.UpdatedAt || "",
      UsageCount: Number(tag?.UsageCount || 0),
    })).filter((tag) => tag.TagId && tag.Text);
    filterOptions.tags = tagRegistry.value;
    const ids = tagRegistry.value.map((tag) => tag.TagId);
    pruneRecentTags(ids);
    if (query.filters.tag && !ids.includes(query.filters.tag)) query.filters.tag = "";
  }

  async function loadTags() {
    const result = await api.listTags?.();
    if (result?.ok) applyTagRegistry(result.tags);
  }

  function selectedTagIdsForTarget(target) {
    return target === "batch" ? batchEdit.tagIds : editDraft.TagIds;
  }

  function getTagCandidates(target) {
    const keyword = normalizeText(tagSearch[target]);
    const selected = new Set(selectedTagIdsForTarget(target));
    return tagRegistry.value
      .filter((tag) => !keyword || tag.Text.includes(keyword) || tag.Description.includes(keyword))
      .sort((a, b) => Number(selected.has(b.TagId)) - Number(selected.has(a.TagId)) || a.Text.localeCompare(b.Text, "zh-CN"));
  }

  function getTagOptions(target) { return getTagCandidates(target).slice(0, 50); }

  function getRecentTagOptions(target) {
    const byId = new Map(getTagCandidates(target).map((tag) => [tag.TagId, tag]));
    return recentTags.value.map((id) => byId.get(id)).filter(Boolean).slice(0, 3);
  }

  function getTagDefinition(tagId) { return tagRegistry.value.find((tag) => tag.TagId === tagId) || null; }
  function getTagDescription(tagId) { return getTagDefinition(tagId)?.Description || ""; }
  function getTagText(tagId) { return getTagDefinition(tagId)?.Text || ""; }

  function openTagDropdown(target) {
    const shouldOpen = !tagDropdown[target];
    closeOtherRegistryDropdowns?.();
    tagDropdown[target] = shouldOpen;
  }
  function closeTagDropdown(target) { tagDropdown[target] = false; }
  function closeAllTagDropdowns() { tagDropdown.viewer = false; tagDropdown.batch = false; }

  function addTagToTarget(target, tagId) {
    const definition = getTagDefinition(tagId);
    if (!definition) return;
    const ids = selectedTagIdsForTarget(target);
    if (ids.includes(tagId)) {
      showToastMessage(`标签“${definition.Text}”已存在，添加失败`);
    } else {
      ids.push(tagId);
      rememberRecentTag(tagId);
      if (target === "viewer") requestEdit("Tags");
    }
    tagSearch[target] = "";
    closeTagDropdown(target);
  }

  function addTag() {
    const first = getTagOptions("viewer")[0];
    if (first) addTagToTarget("viewer", first.TagId);
  }

  function onTagSearchKeydown(event, target) {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = getRecentTagOptions(target)[0] || getTagOptions(target)[0];
      if (first) addTagToTarget(target, first.TagId);
    } else if (event.key === "Escape") closeTagDropdown(target);
    else if (event.key === "Backspace" && !tagSearch[target]) {
      event.preventDefault();
      if (target === "batch") removeBatchTagAt(batchEdit.tagIds.length - 1);
      else removeViewerTagAt(editDraft.TagIds.length - 1);
    }
  }

  function openCreateTagMenu(target) {
    closeOtherRegistryDropdowns?.();
    Object.assign(tagCreate, {
      visible: true,
      target,
      text: target === "manager" ? "" : normalizeText(tagSearch[target]),
      description: "",
      error: "",
    });
    if (target !== "manager") closeTagDropdown(target);
  }
  function closeCreateTagMenu() { Object.assign(tagCreate, { visible: false, text: "", description: "", error: "" }); }

  async function createTagAndSelect() {
    const text = normalizeText(tagCreate.text);
    if (!text) { tagCreate.error = "标签名称不能为空"; return; }
    const result = await api.createTag({ text, description: normalizeText(tagCreate.description) });
    if (!result?.ok) { tagCreate.error = result?.error || "创建标签失败"; return; }
    applyTagRegistry(result.tags);
    const target = tagCreate.target;
    if (target === "manager") showToastMessage(`已创建标签“${result.tag.Text}”`);
    else addTagToTarget(target, result.tag.TagId);
    closeCreateTagMenu();
  }

  async function openTagManager() {
    gallerySettingsOpen.value = false;
    closeOtherRegistryDropdowns?.();
    await loadTags();
    tagManager.visible = true;
    tagManager.error = "";
  }
  function closeTagManager() {
    if (tagCreate.target === "manager") closeCreateTagMenu();
    Object.assign(tagManager, { visible: false, search: "", editingId: "", editDescription: "", error: "" });
  }
  function startTagDescriptionEdit(tag) {
    Object.assign(tagManager, { editingId: tag.TagId, editDescription: tag.Description || "", error: "" });
  }
  function cancelTagDescriptionEdit() { Object.assign(tagManager, { editingId: "", editDescription: "", error: "" }); }
  async function saveTagDescription() {
    const tagId = tagManager.editingId;
    if (!tagId) { tagManager.error = "标签不存在"; return; }
    const result = await api.updateTagDescription({ tagId, description: normalizeText(tagManager.editDescription) });
    if (!result?.ok) { tagManager.error = result?.error || "保存说明失败"; return; }
    applyTagRegistry(result.tags);
    cancelTagDescriptionEdit();
    showToastMessage("标签说明已更新");
  }

  function stripTagFromItem(item, tagId) {
    const ids = Array.isArray(item?.Customization?.TagIds) ? item.Customization.TagIds : [];
    return ids.includes(tagId)
      ? { ...item, Customization: { ...(item.Customization || {}), TagIds: ids.filter((id) => id !== tagId) } }
      : item;
  }
  function syncDeletedTagLocally(tagId) {
    if (selectedItem.value) selectedItem.value = stripTagFromItem(selectedItem.value, tagId);
    editDraft.TagIds = editDraft.TagIds.filter((id) => id !== tagId);
    batchEdit.tagIds = batchEdit.tagIds.filter((id) => id !== tagId);
    orderedItems.value = orderedItems.value.map((item) => stripTagFromItem(item, tagId));
    rebuildGalleryItemIndex();
    for (const group of galleryGroups.value) group.items = group.items.map((item) => galleryItemIndex.get(item.MediaId) || item);
    triggerRef(galleryGroups);
  }
  async function deleteTagGlobally(tag) {
    const usage = Number(tag?.UsageCount || 0);
    if (!window.confirm(`确定全局删除标签“${tag.Text}”？这会从 ${usage} 个媒体中移除。`)) return;
    const result = await api.deleteTagGlobally({ tagId: tag.TagId });
    if (!result?.ok) { showToastMessage(`删除标签失败：${result?.error || "未知错误"}`); return; }
    applyTagRegistry(result.tags);
    syncDeletedTagLocally(tag.TagId);
    if (query.filters.tag === tag.TagId) { query.filters.tag = ""; await queryGallery(); }
    showToastMessage(`已全局删除标签“${tag.Text}”`);
  }

  function resetTagState() {
    tagRegistry.value = [];
    Object.assign(tagSearch, { viewer: "", batch: "" });
    closeAllTagDropdowns();
    closeCreateTagMenu();
    Object.assign(tagManager, { visible: false, search: "", editingId: "", editDescription: "", error: "" });
  }

  return {
    tagRegistry, tagSearch, tagDropdown, tagCreate, tagManager, managerFilteredTags,
    loadTags, getTagOptions, getRecentTagOptions, getTagDescription, getTagText,
    openTagDropdown, closeTagDropdown, closeAllTagDropdowns, addTagToTarget, addTag,
    onTagSearchKeydown, openCreateTagMenu, closeCreateTagMenu, createTagAndSelect,
    openTagManager, closeTagManager, startTagDescriptionEdit, cancelTagDescriptionEdit,
    saveTagDescription, deleteTagGlobally, resetTagState,
  };
}
