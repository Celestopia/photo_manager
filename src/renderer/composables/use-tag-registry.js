import { useFlatRegistryState, normalizeRegistryText as normalizeText } from "./use-flat-registry-state.js";
import { createRegistryRequests } from "../domain/registry-requests.mjs";
import {
  patchRegistryReferencesInPlace,
  registryDeletionInvalidatesFilter,
  removeRegistryReference,
} from "../domain/registry-deletion.mjs";


/** Owns the ID-backed tag registry, picker state, and tag-management workflow. */
export function useTagRegistry({
  requestConfirm,
  api, unassignedFilter, query, editDraft, batchEdit, selectedItem, orderedItems,
  gallerySettingsOpen, recentTags, rememberRecentTag, pruneRecentTags,
  showToastMessage, closeOtherRegistryDropdowns, requestEdit,
  queryGallery,
}) {
  const {
    registry: tagRegistry, search: tagSearch, dropdown: tagDropdown,
    create: tagCreate, manager: tagManager, managerFiltered: managerFilteredTags, apply: applyTagRegistry,
    find: getTagDefinition, candidates, startEdit: startTagEdit, cancelEdit: cancelTagEdit,
  } = useFlatRegistryState({
    idKey: "TagId", labelKey: "Text", filterKey: "tag", query, unassignedFilter, pruneRecent: pruneRecentTags,
  });
  const requests = createRegistryRequests(tagManager);

  async function loadTags() {
    const result = await requests.run(() => api.listTags?.(), { read: true });
    if (result?.ok) applyTagRegistry(result.tags);
    else if (result) showToastMessage(result.error || "Could not load tags");
  }

  function selectedTagIdsForTarget(target) {
    return target === "batch" ? batchEdit.tagIds : editDraft.TagIds;
  }

  function getTagCandidates(target) { return candidates(target, selectedTagIdsForTarget(target)); }

  function getTagOptions(target) { return getTagCandidates(target).slice(0, 50); }

  function getRecentTagOptions(target) {
    const byId = new Map(getTagCandidates(target).map((tag) => [tag.TagId, tag]));
    return recentTags.value.map((id) => byId.get(id)).filter(Boolean).slice(0, 3);
  }

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
    if (tagManager.saving) return;
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
  function closeCreateTagMenu() {
    if (tagManager.saving) return; Object.assign(tagCreate, { visible: false, text: "", description: "", error: "" }); }

  async function createTagAndSelect() {
    if (tagManager.saving) return;
    const text = normalizeText(tagCreate.text);
    if (!text) { tagCreate.error = "Tag name is required"; return; }
    const target = tagCreate.target;
    const mediaId = selectedItem.value?.MediaId;
    const result = await requests.run(() => api.createTag({ text, description: normalizeText(tagCreate.description) }), { ownsTarget: () => tagCreate.visible && tagCreate.target === target && (target !== "viewer" || selectedItem.value?.MediaId === mediaId) });
    if (!result) return;
    if (!result?.ok) { tagCreate.error = result?.error || "Could not create tag"; return; }
    applyTagRegistry(result.tags);
    if (target === "manager") showToastMessage(`Created tag “${result.tag.Text}”`);
    else addTagToTarget(target, result.tag.TagId);
    closeCreateTagMenu();
  }

  async function openTagManager() {
    gallerySettingsOpen.value = false;
    closeOtherRegistryDropdowns?.();
    if (tagManager.saving) return;
    tagManager.visible = true;
    tagManager.error = "";
    await loadTags();
  }
  function closeTagManager() {
    if (tagManager.saving) return;
    if (tagCreate.target === "manager") closeCreateTagMenu();
    Object.assign(tagManager, {
      visible: false, search: "", editingId: "", editText: "", editDescription: "", saving: false, error: "",
    });
  }
  async function saveTagEdit() {
    if (tagManager.saving) return;
    const tagId = tagManager.editingId;
    const text = normalizeText(tagManager.editText);
    if (!tagId) { tagManager.error = "Tag not found"; return; }
    if (!text) { tagManager.error = "Tag name is required"; return; }
    const previousText = getTagText(tagId);
    const result = await requests.run(() => api.updateTag({ tagId, text, description: normalizeText(tagManager.editDescription) }));
    if (!result) return;
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
    if (tagManager.saving) return;
    const usage = Number(tag?.UsageCount || 0);
    const stillCurrent = requests.capture();
    if (!await requestConfirm({ title: "Delete tag?", confirmLabel: "Delete tag", danger: true, message: `Delete tag “${tag.Text}” from the entire library? This will remove it from ${usage} media item(s).` + "\n\nMedia files will remain unchanged." }) || !stillCurrent()) return;
    const result = await requests.run(() => api.deleteTagGlobally({ tagId: tag.TagId }));
    if (!result) return;
    if (!result?.ok) { showToastMessage(`Could not delete tag: ${result?.error || "Unknown error"}`); return; }
    const filterBeforeDelete = query.filters.tag;
    const shouldRefreshGallery = registryDeletionInvalidatesFilter(
      filterBeforeDelete, tag.TagId, unassignedFilter, result.updatedCount,
    );
    applyTagRegistry(result.tags);
    syncDeletedTagLocally(tag.TagId, Number(result.updatedCount) > 0 && !shouldRefreshGallery);
    const current = requests.capture();
    if (shouldRefreshGallery) await queryGallery();
    if (!current()) return;
    showToastMessage(`Deleted tag “${tag.Text}” from the library`);
  }

  function resetTagState() {
    requests.reset();
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
