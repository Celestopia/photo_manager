import { computed, reactive, ref } from "vue";
import { isRegistryFilterValueValid } from "../domain/gallery-filter-state.mjs";
import {
  patchRegistryReferencesInPlace,
  registryDeletionInvalidatesFilter,
  removeRegistryReference,
} from "../domain/registry-deletion.mjs";

function normalizeText(value) {
  return String(value ?? "").trim();
}

/** Owns the ID-backed tag registry, picker state, and tag-management workflow. */
export function useTagRegistry({
  api, unassignedFilter, query, editDraft, batchEdit, selectedItem, orderedItems,
  gallerySettingsOpen, recentTags, rememberRecentTag, pruneRecentTags,
  showToastMessage, closeOtherRegistryDropdowns, requestEdit,
  queryGallery,
}) {
  const tagRegistry = ref([]);
  const tagSearch = reactive({ viewer: "", batch: "" });
  const tagDropdown = reactive({ viewer: false, batch: false });
  const tagCreate = reactive({ visible: false, target: "viewer", text: "", description: "", error: "" });
  const tagManager = reactive({
    visible: false, search: "", editingId: "", editText: "", editDescription: "", saving: false, error: "",
  });

  const managerFilteredTags = computed(() => {
    const keyword = tagManager.search.trim();
    const source = [...tagRegistry.value].sort((a, b) => a.Text.localeCompare(b.Text, "en-US"));
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
    const ids = tagRegistry.value.map((tag) => tag.TagId);
    pruneRecentTags(ids);
    if (!isRegistryFilterValueValid(query.filters.tag, ids, unassignedFilter)) query.filters.tag = "";
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
      .sort((a, b) => Number(selected.has(b.TagId)) - Number(selected.has(a.TagId)) || a.Text.localeCompare(b.Text, "en-US"));
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
      showToastMessage(`Tag “${definition.Text}” is already assigned`);
    } else {
      ids.push(tagId);
      rememberRecentTag(tagId);
      if (target === "viewer") requestEdit("Tags");
    }
    tagSearch[target] = "";
    closeTagDropdown(target);
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
    if (!text) { tagCreate.error = "Tag name is required"; return; }
    const result = await api.createTag({ text, description: normalizeText(tagCreate.description) });
    if (!result?.ok) { tagCreate.error = result?.error || "Could not create tag"; return; }
    applyTagRegistry(result.tags);
    const target = tagCreate.target;
    if (target === "manager") showToastMessage(`Created tag “${result.tag.Text}”`);
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
    if (tagManager.saving) return;
    if (tagCreate.target === "manager") closeCreateTagMenu();
    Object.assign(tagManager, {
      visible: false, search: "", editingId: "", editText: "", editDescription: "", saving: false, error: "",
    });
  }
  function startTagEdit(tag) {
    if (tagManager.saving) return;
    Object.assign(tagManager, {
      editingId: tag.TagId, editText: tag.Text || "", editDescription: tag.Description || "", saving: false, error: "",
    });
  }
  function cancelTagEdit() {
    if (tagManager.saving) return;
    Object.assign(tagManager, { editingId: "", editText: "", editDescription: "", saving: false, error: "" });
  }
  async function saveTagEdit() {
    const tagId = tagManager.editingId;
    const text = normalizeText(tagManager.editText);
    if (!tagId) { tagManager.error = "Tag not found"; return; }
    if (!text) { tagManager.error = "Tag name is required"; return; }
    const previousText = getTagText(tagId);
    tagManager.saving = true;
    let result;
    try {
      result = await api.updateTag({ tagId, text, description: normalizeText(tagManager.editDescription) });
    } catch {
      tagManager.saving = false;
      tagManager.error = "Could not save tag";
      return;
    }
    tagManager.saving = false;
    if (!result?.ok) { tagManager.error = result?.error || "Could not save tag"; return; }
    applyTagRegistry(result.tags);
    cancelTagEdit();
    showToastMessage(previousText === text ? "Tag updated" : `Renamed tag “${previousText}” to “${text}”`);
  }

  function syncDeletedTagLocally(tagId, patchGallery) {
    if (selectedItem.value) selectedItem.value = removeRegistryReference(selectedItem.value, "tag", tagId);
    editDraft.TagIds = editDraft.TagIds.filter((id) => id !== tagId);
    batchEdit.tagIds = batchEdit.tagIds.filter((id) => id !== tagId);
    if (patchGallery) patchRegistryReferencesInPlace(orderedItems.value, "tag", tagId);
  }
  async function deleteTagGlobally(tag) {
    const usage = Number(tag?.UsageCount || 0);
    if (!window.confirm(`Delete tag “${tag.Text}” from the entire library? This will remove it from ${usage} media item(s).`)) return;
    const result = await api.deleteTagGlobally({ tagId: tag.TagId });
    if (!result?.ok) { showToastMessage(`Could not delete tag: ${result?.error || "Unknown error"}`); return; }
    const filterBeforeDelete = query.filters.tag;
    const shouldRefreshGallery = registryDeletionInvalidatesFilter(
      filterBeforeDelete, tag.TagId, unassignedFilter, result.updatedCount,
    );
    applyTagRegistry(result.tags);
    syncDeletedTagLocally(tag.TagId, Number(result.updatedCount) > 0 && !shouldRefreshGallery);
    if (shouldRefreshGallery) await queryGallery();
    showToastMessage(`Deleted tag “${tag.Text}” from the library`);
  }

  function resetTagState() {
    tagRegistry.value = [];
    Object.assign(tagSearch, { viewer: "", batch: "" });
    closeAllTagDropdowns();
    closeCreateTagMenu();
    Object.assign(tagManager, {
      visible: false, search: "", editingId: "", editText: "", editDescription: "", saving: false, error: "",
    });
  }

  return {
    tagRegistry, tagSearch, tagDropdown, tagCreate, tagManager, managerFilteredTags,
    loadTags, getTagOptions, getRecentTagOptions, getTagDescription, getTagText,
    openTagDropdown, closeTagDropdown, closeAllTagDropdowns, addTagToTarget,
    openCreateTagMenu, closeCreateTagMenu, createTagAndSelect,
    openTagManager, closeTagManager, startTagEdit, cancelTagEdit,
    saveTagEdit, deleteTagGlobally, resetTagState,
  };
}
