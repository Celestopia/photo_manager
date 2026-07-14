import { computed, reactive, ref, triggerRef } from "vue";

function normalizeTagText(value) {
  return String(value ?? "").trim();
}

/** Owns the controlled tag registry, picker state, and tag-management workflow. */
export function useTagRegistry({
  api,
  filterOptions,
  query,
  editDraft,
  batchEdit,
  selectedItem,
  orderedItems,
  galleryGroups,
  gallerySettingsOpen,
  recentTags,
  rememberRecentTag,
  pruneRecentTags,
  showToastMessage,
  closeOtherRegistryDropdowns,
  requestEdit,
  removeViewerTagAt,
  removeBatchTagAt,
  rebuildGalleryItemIndex,
  galleryItemIndex,
  queryGallery,
}) {
  const tagRegistry = ref([]);
  const tagSearch = reactive({ viewer: "", batch: "" });
  const tagDropdown = reactive({ viewer: false, batch: false });
  const tagCreate = reactive({ visible: false, target: "viewer", text: "", description: "", error: "" });
  const tagManager = reactive({ visible: false, search: "", editingText: "", editDescription: "", error: "" });

  const managerFilteredTags = computed(() => {
    const keyword = tagManager.search.trim();
    const source = [...tagRegistry.value].sort((a, b) => a.Text.localeCompare(b.Text, "zh-CN"));
    if (!keyword) return source;
    return source.filter((tag) => tag.Text.includes(keyword) || (tag.Description || "").includes(keyword));
  });

  function applyTagRegistry(tags) {
    tagRegistry.value = (Array.isArray(tags) ? tags : [])
      .map((tag) => ({
        Text: normalizeTagText(tag?.Text),
        Description: normalizeTagText(tag?.Description),
        CreatedAt: tag?.CreatedAt || "",
        UpdatedAt: tag?.UpdatedAt || "",
        UsageCount: Number(tag?.UsageCount || 0),
      }))
      .filter((tag) => tag.Text);
    filterOptions.tags = tagRegistry.value.map((tag) => tag.Text);
    pruneRecentTags(filterOptions.tags);
    if (query.filters.tag && !filterOptions.tags.includes(query.filters.tag)) query.filters.tag = "";
  }

  async function loadTags() {
    if (typeof api.listTags !== "function") return;
    const result = await api.listTags();
    if (result?.ok) applyTagRegistry(result.tags);
  }

  function selectedTagsForTarget(target) {
    return target === "batch" ? batchEdit.tags : editDraft.Tags;
  }

  function getTagCandidates(target) {
    const keyword = normalizeTagText(tagSearch[target]);
    const selected = new Set(selectedTagsForTarget(target));
    return tagRegistry.value
      .filter((tag) => !keyword || tag.Text.includes(keyword) || (tag.Description || "").includes(keyword))
      .sort((a, b) => Number(selected.has(b.Text)) - Number(selected.has(a.Text)) || a.Text.localeCompare(b.Text, "zh-CN"));
  }

  function getTagOptions(target) { return getTagCandidates(target).slice(0, 50); }

  function getRecentTagOptions(target) {
    const byText = new Map(getTagCandidates(target).map((tag) => [tag.Text, tag]));
    return recentTags.value.map((text) => byText.get(text)).filter(Boolean).slice(0, 3);
  }

  function getTagDescription(tagText) {
    return tagRegistry.value.find((tag) => tag.Text === tagText)?.Description || "";
  }

  function openTagDropdown(target) {
    const shouldOpen = !tagDropdown[target];
    closeOtherRegistryDropdowns?.();
    tagDropdown[target] = shouldOpen;
  }

  function closeTagDropdown(target) { tagDropdown[target] = false; }

  function closeAllTagDropdowns() {
    tagDropdown.viewer = false;
    tagDropdown.batch = false;
  }

  function addTagToTarget(target, rawTagText) {
    const tagText = normalizeTagText(rawTagText);
    if (!tagText) return;
    const tags = selectedTagsForTarget(target);
    if (tags.includes(tagText)) {
      showToastMessage(`标签“${tagText}”已存在，添加失败`);
      tagSearch[target] = "";
      closeTagDropdown(target);
      return;
    }
    tags.push(tagText);
    rememberRecentTag(tagText);
    tagSearch[target] = "";
    closeTagDropdown(target);
    if (target === "viewer") requestEdit("Tags");
  }

  function addTag() {
    const first = getTagOptions("viewer")[0];
    if (first) addTagToTarget("viewer", first.Text);
  }

  function onTagSearchKeydown(event, target) {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = getRecentTagOptions(target)[0] || getTagOptions(target)[0];
      if (first) addTagToTarget(target, first.Text);
      return;
    }
    if (event.key === "Escape") {
      closeTagDropdown(target);
      return;
    }
    if (event.key === "Backspace" && !tagSearch[target]) {
      event.preventDefault();
      if (target === "batch") removeBatchTagAt(batchEdit.tags.length - 1);
      else removeViewerTagAt(editDraft.Tags.length - 1);
    }
  }

  function openCreateTagMenu(target) {
    closeOtherRegistryDropdowns?.();
    tagCreate.visible = true;
    tagCreate.target = target;
    tagCreate.text = target === "manager" ? "" : normalizeTagText(tagSearch[target]);
    tagCreate.description = "";
    tagCreate.error = "";
    if (target !== "manager") closeTagDropdown(target);
  }

  function closeCreateTagMenu() {
    Object.assign(tagCreate, { visible: false, text: "", description: "", error: "" });
  }

  async function createTagAndSelect() {
    const text = normalizeTagText(tagCreate.text);
    const description = normalizeTagText(tagCreate.description);
    if (!text) {
      tagCreate.error = "标签名称不能为空";
      return;
    }
    const result = await api.createTag({ text, description });
    if (!result?.ok) {
      tagCreate.error = result?.error || "创建标签失败";
      return;
    }
    applyTagRegistry(result.tags);
    const target = tagCreate.target;
    if (target === "manager") showToastMessage(`已创建标签“${result.tag.Text}”`);
    else addTagToTarget(target, result.tag.Text);
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
    Object.assign(tagManager, { visible: false, search: "", editingText: "", editDescription: "", error: "" });
  }

  function startTagDescriptionEdit(tag) {
    Object.assign(tagManager, { editingText: tag.Text, editDescription: tag.Description || "", error: "" });
  }

  function cancelTagDescriptionEdit() {
    Object.assign(tagManager, { editingText: "", editDescription: "", error: "" });
  }

  async function saveTagDescription() {
    const text = tagManager.editingText;
    const description = normalizeTagText(tagManager.editDescription);
    if (!text) {
      tagManager.error = "标签不存在";
      return;
    }
    const result = await api.updateTagDescription({ text, description });
    if (!result?.ok) {
      tagManager.error = result?.error || "保存说明失败";
      return;
    }
    applyTagRegistry(result.tags);
    cancelTagDescriptionEdit();
    showToastMessage("标签说明已更新");
  }

  function stripTagFromItem(item, tagText) {
    const tags = Array.isArray(item?.Customization?.Tags) ? item.Customization.Tags : [];
    if (!tags.includes(tagText)) return item;
    return { ...item, Customization: { ...(item.Customization || {}), Tags: tags.filter((tag) => tag !== tagText) } };
  }

  function syncDeletedTagLocally(tagText) {
    if (selectedItem.value) selectedItem.value = stripTagFromItem(selectedItem.value, tagText);
    editDraft.Tags = editDraft.Tags.filter((tag) => tag !== tagText);
    batchEdit.tags = batchEdit.tags.filter((tag) => tag !== tagText);
    orderedItems.value = orderedItems.value.map((item) => stripTagFromItem(item, tagText));
    rebuildGalleryItemIndex();
    for (const group of galleryGroups.value) {
      group.items = group.items.map((item) => galleryItemIndex.get(item.FilePath) || item);
    }
    triggerRef(galleryGroups);
  }

  async function deleteTagGlobally(tag) {
    const usage = Number(tag?.UsageCount || 0);
    if (!window.confirm(`确定全局删除标签“${tag.Text}”？这会从 ${usage} 个媒体中移除。`)) return;
    const result = await api.deleteTagGlobally({ text: tag.Text });
    if (!result?.ok) {
      showToastMessage(`删除标签失败：${result?.error || "未知错误"}`);
      return;
    }
    applyTagRegistry(result.tags);
    syncDeletedTagLocally(tag.Text);
    if (query.filters.tag === tag.Text) {
      query.filters.tag = "";
      await queryGallery();
    }
    showToastMessage(`已全局删除标签“${tag.Text}”`);
  }

  function resetTagState() {
    tagRegistry.value = [];
    Object.assign(tagSearch, { viewer: "", batch: "" });
    closeAllTagDropdowns();
    closeCreateTagMenu();
    Object.assign(tagManager, { visible: false, search: "", editingText: "", editDescription: "", error: "" });
  }

  return {
    tagRegistry,
    tagSearch,
    tagDropdown,
    tagCreate,
    tagManager,
    managerFilteredTags,
    loadTags,
    getTagOptions,
    getRecentTagOptions,
    getTagDescription,
    openTagDropdown,
    closeTagDropdown,
    closeAllTagDropdowns,
    addTagToTarget,
    addTag,
    onTagSearchKeydown,
    openCreateTagMenu,
    closeCreateTagMenu,
    createTagAndSelect,
    openTagManager,
    closeTagManager,
    startTagDescriptionEdit,
    cancelTagDescriptionEdit,
    saveTagDescription,
    deleteTagGlobally,
    resetTagState,
  };
}
