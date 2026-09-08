import { computed, reactive, ref } from "vue";
import { isRegistryFilterValueValid } from "../domain/gallery-filter-state.mjs";
import {
  patchRegistryReferencesInPlace,
  registryDeletionInvalidatesFilter,
  removeRegistryReference,
} from "../domain/registry-deletion.mjs";

function normalizeText(value) { return String(value ?? "").trim(); }

/** Owns the ID-backed single-valued album registry and management workflow. */
export function useAlbumRegistry({
  api, unassignedFilter, query, editDraft, batchEdit, selectedItem,
  orderedItems, gallerySettingsOpen, showToastMessage,
  closeOtherRegistryDropdowns, requestEdit, queryGallery,
}) {
  const albumRegistry = ref([]);
  const albumSearch = reactive({ viewer: "", batch: "" });
  const albumDropdown = reactive({ viewer: false, batch: false });
  const albumCreate = reactive({ visible: false, target: "viewer", title: "", description: "", error: "" });
  const albumManager = reactive({
    visible: false, search: "", editingId: "", editTitle: "", editDescription: "", saving: false, error: "",
  });

  const managerFilteredAlbums = computed(() => {
    const keyword = albumManager.search.trim();
    const source = [...albumRegistry.value].sort((a, b) => a.Title.localeCompare(b.Title, "en-US"));
    return keyword ? source.filter((album) => album.Title.includes(keyword) || album.Description.includes(keyword)) : source;
  });

  function applyAlbumRegistry(albums) {
    albumRegistry.value = (Array.isArray(albums) ? albums : []).map((album) => ({
      AlbumId: normalizeText(album?.AlbumId),
      Title: normalizeText(album?.Title),
      Description: normalizeText(album?.Description),
      CreatedAt: album?.CreatedAt || "",
      UpdatedAt: album?.UpdatedAt || "",
      UsageCount: Number(album?.UsageCount || 0),
    })).filter((album) => album.AlbumId && album.Title);
    const ids = albumRegistry.value.map((album) => album.AlbumId);
    if (!isRegistryFilterValueValid(query.filters.album, ids, unassignedFilter)) query.filters.album = "";
  }

  async function loadAlbums() {
    const result = await api.listAlbums?.();
    if (result?.ok) applyAlbumRegistry(result.albums);
  }

  function selectedAlbumIdForTarget(target) { return target === "batch" ? batchEdit.albumId : editDraft.AlbumId; }
  function getAlbumDefinition(albumId) { return albumRegistry.value.find((album) => album.AlbumId === albumId) || null; }
  function getAlbumDescription(albumId) { return getAlbumDefinition(albumId)?.Description || ""; }
  function getAlbumTitle(albumId) { return getAlbumDefinition(albumId)?.Title || ""; }
  function getAlbumOptions(target) {
    const keyword = normalizeText(albumSearch[target]);
    const selectedId = selectedAlbumIdForTarget(target);
    return albumRegistry.value
      .filter((album) => !keyword || album.Title.includes(keyword) || album.Description.includes(keyword))
      .sort((a, b) => Number(b.AlbumId === selectedId) - Number(a.AlbumId === selectedId) || a.Title.localeCompare(b.Title, "en-US"))
      .slice(0, 50);
  }

  function openAlbumDropdown(target) {
    const shouldOpen = !albumDropdown[target];
    closeOtherRegistryDropdowns?.();
    albumDropdown[target] = shouldOpen;
  }
  function closeAlbumDropdown(target) { albumDropdown[target] = false; }
  function closeAllAlbumDropdowns() { albumDropdown.viewer = false; albumDropdown.batch = false; }

  function setAlbumForTarget(target, albumId) {
    if (!getAlbumDefinition(albumId)) return;
    if (target === "batch") batchEdit.albumId = albumId;
    else { editDraft.AlbumId = albumId; requestEdit("Album"); }
    albumSearch[target] = "";
    closeAlbumDropdown(target);
  }
  function clearAlbumForTarget(target) {
    if (target === "batch") batchEdit.albumId = null;
    else { editDraft.AlbumId = null; requestEdit("Album"); }
    albumSearch[target] = "";
    closeAlbumDropdown(target);
  }
  function openCreateAlbumMenu(target) {
    closeOtherRegistryDropdowns?.();
    Object.assign(albumCreate, {
      visible: true, target,
      title: target === "manager" ? "" : normalizeText(albumSearch[target]),
      description: "", error: "",
    });
    if (target !== "manager") closeAlbumDropdown(target);
  }
  function closeCreateAlbumMenu() { Object.assign(albumCreate, { visible: false, title: "", description: "", error: "" }); }
  async function createAlbumAndSelect() {
    const title = normalizeText(albumCreate.title);
    const description = normalizeText(albumCreate.description);
    if (!title || !description) { albumCreate.error = "Album name and description are required"; return; }
    const result = await api.createAlbum({ title, description });
    if (!result?.ok) { albumCreate.error = result?.error || "Could not create album"; return; }
    applyAlbumRegistry(result.albums);
    const target = albumCreate.target;
    if (target === "manager") showToastMessage(`Created album “${result.album.Title}”`);
    else setAlbumForTarget(target, result.album.AlbumId);
    closeCreateAlbumMenu();
  }

  async function openAlbumManager() {
    gallerySettingsOpen.value = false;
    closeOtherRegistryDropdowns?.();
    await loadAlbums();
    albumManager.visible = true;
    albumManager.error = "";
  }
  function closeAlbumManager() {
    if (albumManager.saving) return;
    if (albumCreate.target === "manager") closeCreateAlbumMenu();
    Object.assign(albumManager, {
      visible: false, search: "", editingId: "", editTitle: "", editDescription: "", saving: false, error: "",
    });
  }
  function startAlbumEdit(album) {
    if (albumManager.saving) return;
    Object.assign(albumManager, {
      editingId: album.AlbumId, editTitle: album.Title || "", editDescription: album.Description || "", saving: false, error: "",
    });
  }
  function cancelAlbumEdit() {
    if (albumManager.saving) return;
    Object.assign(albumManager, { editingId: "", editTitle: "", editDescription: "", saving: false, error: "" });
  }
  async function saveAlbumEdit() {
    const albumId = albumManager.editingId;
    const title = normalizeText(albumManager.editTitle);
    const description = normalizeText(albumManager.editDescription);
    if (!albumId) { albumManager.error = "Album not found"; return; }
    if (!title || !description) { albumManager.error = "Album name and description are required"; return; }
    const previousTitle = getAlbumTitle(albumId);
    albumManager.saving = true;
    let result;
    try {
      result = await api.updateAlbum({ albumId, title, description });
    } catch {
      albumManager.saving = false;
      albumManager.error = "Could not save album";
      return;
    }
    albumManager.saving = false;
    if (!result?.ok) { albumManager.error = result?.error || "Could not save album"; return; }
    applyAlbumRegistry(result.albums);
    cancelAlbumEdit();
    showToastMessage(previousTitle === title ? "Album updated" : `Renamed album “${previousTitle}” to “${title}”`);
  }

  function syncDeletedAlbumLocally(albumId, patchGallery) {
    if (selectedItem.value) selectedItem.value = removeRegistryReference(selectedItem.value, "album", albumId);
    if (editDraft.AlbumId === albumId) editDraft.AlbumId = null;
    if (batchEdit.albumId === albumId) batchEdit.albumId = null;
    if (patchGallery) patchRegistryReferencesInPlace(orderedItems.value, "album", albumId);
  }
  async function deleteAlbumGlobally(album) {
    const usage = Number(album?.UsageCount || 0);
    if (!window.confirm(`Delete album “${album.Title}” from the entire library? This will clear the album field on ${usage} media item(s).`)) return;
    const result = await api.deleteAlbumGlobally({ albumId: album.AlbumId });
    if (!result?.ok) { showToastMessage(`Could not delete album: ${result?.error || "Unknown error"}`); return; }
    const filterBeforeDelete = query.filters.album;
    const shouldRefreshGallery = registryDeletionInvalidatesFilter(
      filterBeforeDelete, album.AlbumId, unassignedFilter, result.updatedCount,
    );
    applyAlbumRegistry(result.albums);
    syncDeletedAlbumLocally(album.AlbumId, Number(result.updatedCount) > 0 && !shouldRefreshGallery);
    if (shouldRefreshGallery) await queryGallery();
    showToastMessage(`Deleted album “${album.Title}” from the library`);
  }

  function resetAlbumState() {
    albumRegistry.value = [];
    Object.assign(albumSearch, { viewer: "", batch: "" });
    closeAllAlbumDropdowns(); closeCreateAlbumMenu();
    Object.assign(albumManager, {
      visible: false, search: "", editingId: "", editTitle: "", editDescription: "", saving: false, error: "",
    });
  }

  return {
    albumRegistry, albumSearch, albumDropdown, albumCreate, albumManager, managerFilteredAlbums,
    loadAlbums, getAlbumOptions, getAlbumDescription, getAlbumTitle, openAlbumDropdown,
    closeAlbumDropdown, closeAllAlbumDropdowns, setAlbumForTarget, clearAlbumForTarget,
    openCreateAlbumMenu, closeCreateAlbumMenu, createAlbumAndSelect,
    openAlbumManager, closeAlbumManager, startAlbumEdit, cancelAlbumEdit,
    saveAlbumEdit, deleteAlbumGlobally, resetAlbumState,
  };
}
