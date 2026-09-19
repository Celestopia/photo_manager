import { useFlatRegistryState, normalizeRegistryText as normalizeText } from "./use-flat-registry-state.js";
import { createRegistryRequests } from "../domain/registry-requests.mjs";
import {
  patchRegistryReferencesInPlace,
  registryDeletionInvalidatesFilter,
  removeRegistryReference,
} from "../domain/registry-deletion.mjs";


/** Owns the ID-backed single-valued album registry and management workflow. */
export function useAlbumRegistry({
  api, unassignedFilter, query, editDraft, batchEdit, selectedItem,
  orderedItems, gallerySettingsOpen, showToastMessage,
  closeOtherRegistryDropdowns, requestEdit, queryGallery,
}) {
  const {
    registry: albumRegistry, search: albumSearch, dropdown: albumDropdown,
    create: albumCreate, manager: albumManager, managerFiltered: managerFilteredAlbums, apply: applyAlbumRegistry,
  } = useFlatRegistryState({
    idKey: "AlbumId", labelKey: "Title", filterKey: "album", query, unassignedFilter,
  });
  const requests = createRegistryRequests(albumManager);

  async function loadAlbums() {
    const result = await requests.run(() => api.listAlbums?.(), { read: true });
    if (result?.ok) applyAlbumRegistry(result.albums);
    else if (result) showToastMessage(result.error || "Could not load albums");
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
    if (albumManager.saving) return;
    closeOtherRegistryDropdowns?.();
    Object.assign(albumCreate, {
      visible: true, target,
      title: target === "manager" ? "" : normalizeText(albumSearch[target]),
      description: "", error: "",
    });
    if (target !== "manager") closeAlbumDropdown(target);
  }
  function closeCreateAlbumMenu() {
    if (albumManager.saving) return; Object.assign(albumCreate, { visible: false, title: "", description: "", error: "" }); }
  async function createAlbumAndSelect() {
    if (albumManager.saving) return;
    const title = normalizeText(albumCreate.title);
    const description = normalizeText(albumCreate.description);
    if (!title || !description) { albumCreate.error = "Album name and description are required"; return; }
    const target = albumCreate.target;
    const mediaId = selectedItem.value?.MediaId;
    const result = await requests.run(() => api.createAlbum({ title, description }), { ownsTarget: () => albumCreate.visible && albumCreate.target === target && (target !== "viewer" || selectedItem.value?.MediaId === mediaId) });
    if (!result) return;
    if (!result?.ok) { albumCreate.error = result?.error || "Could not create album"; return; }
    applyAlbumRegistry(result.albums);
    if (target === "manager") showToastMessage(`Created album “${result.album.Title}”`);
    else setAlbumForTarget(target, result.album.AlbumId);
    closeCreateAlbumMenu();
  }

  async function openAlbumManager() {
    gallerySettingsOpen.value = false;
    closeOtherRegistryDropdowns?.();
    if (albumManager.saving) return;
    albumManager.visible = true;
    albumManager.error = "";
    await loadAlbums();
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
    if (albumManager.saving) return;
    const albumId = albumManager.editingId;
    const title = normalizeText(albumManager.editTitle);
    const description = normalizeText(albumManager.editDescription);
    if (!albumId) { albumManager.error = "Album not found"; return; }
    if (!title || !description) { albumManager.error = "Album name and description are required"; return; }
    const previousTitle = getAlbumTitle(albumId);
    const result = await requests.run(() => api.updateAlbum({ albumId, title, description }));
    if (!result) return;
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
    if (albumManager.saving) return;
    const usage = Number(album?.UsageCount || 0);
    if (!window.confirm(`Delete album “${album.Title}” from the entire library? This will clear the album field on ${usage} media item(s).`)) return;
    const result = await requests.run(() => api.deleteAlbumGlobally({ albumId: album.AlbumId }));
    if (!result) return;
    if (!result?.ok) { showToastMessage(`Could not delete album: ${result?.error || "Unknown error"}`); return; }
    const filterBeforeDelete = query.filters.album;
    const shouldRefreshGallery = registryDeletionInvalidatesFilter(
      filterBeforeDelete, album.AlbumId, unassignedFilter, result.updatedCount,
    );
    applyAlbumRegistry(result.albums);
    syncDeletedAlbumLocally(album.AlbumId, Number(result.updatedCount) > 0 && !shouldRefreshGallery);
    const current = requests.capture();
    if (shouldRefreshGallery) await queryGallery();
    if (!current()) return;
    showToastMessage(`Deleted album “${album.Title}” from the library`);
  }

  function resetAlbumState() {
    requests.reset();
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
