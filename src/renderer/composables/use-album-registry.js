import { computed, reactive, ref, triggerRef } from "vue";

function normalizeText(value) { return String(value ?? "").trim(); }

/** Owns the ID-backed single-valued album registry and management workflow. */
export function useAlbumRegistry({
  api, unassignedAlbumFilter, filterOptions, query, editDraft, batchEdit, selectedItem,
  orderedItems, galleryGroups, gallerySettingsOpen, showToastMessage,
  closeOtherRegistryDropdowns, requestEdit, rebuildGalleryItemIndex, galleryItemIndex, queryGallery,
}) {
  const albumRegistry = ref([]);
  const albumSearch = reactive({ viewer: "", batch: "" });
  const albumDropdown = reactive({ viewer: false, batch: false });
  const albumCreate = reactive({ visible: false, target: "viewer", title: "", description: "", error: "" });
  const albumManager = reactive({ visible: false, search: "", editingId: "", editDescription: "", error: "" });

  const managerFilteredAlbums = computed(() => {
    const keyword = albumManager.search.trim();
    const source = [...albumRegistry.value].sort((a, b) => a.Title.localeCompare(b.Title, "zh-CN"));
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
    filterOptions.albums = albumRegistry.value;
    const ids = albumRegistry.value.map((album) => album.AlbumId);
    if (query.filters.album && query.filters.album !== unassignedAlbumFilter && !ids.includes(query.filters.album)) query.filters.album = "";
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
      .sort((a, b) => Number(b.AlbumId === selectedId) - Number(a.AlbumId === selectedId) || a.Title.localeCompare(b.Title, "zh-CN"))
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
  function onAlbumSearchKeydown(event, target) {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = getAlbumOptions(target)[0];
      if (first) setAlbumForTarget(target, first.AlbumId);
    } else if (event.key === "Escape") closeAlbumDropdown(target);
    else if (event.key === "Backspace" && !albumSearch[target] && selectedAlbumIdForTarget(target)) {
      event.preventDefault();
      clearAlbumForTarget(target);
    }
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
    if (!title || !description) { albumCreate.error = "相册名称和说明不能为空"; return; }
    const result = await api.createAlbum({ title, description });
    if (!result?.ok) { albumCreate.error = result?.error || "创建相册失败"; return; }
    applyAlbumRegistry(result.albums);
    const target = albumCreate.target;
    if (target === "manager") showToastMessage(`已创建相册“${result.album.Title}”`);
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
    if (albumCreate.target === "manager") closeCreateAlbumMenu();
    Object.assign(albumManager, { visible: false, search: "", editingId: "", editDescription: "", error: "" });
  }
  function startAlbumDescriptionEdit(album) {
    Object.assign(albumManager, { editingId: album.AlbumId, editDescription: album.Description || "", error: "" });
  }
  function cancelAlbumDescriptionEdit() { Object.assign(albumManager, { editingId: "", editDescription: "", error: "" }); }
  async function saveAlbumDescription() {
    const albumId = albumManager.editingId;
    const description = normalizeText(albumManager.editDescription);
    if (!albumId || !description) { albumManager.error = "说明不能为空"; return; }
    const result = await api.updateAlbumDescription({ albumId, description });
    if (!result?.ok) { albumManager.error = result?.error || "保存说明失败"; return; }
    applyAlbumRegistry(result.albums);
    cancelAlbumDescriptionEdit();
    showToastMessage("相册说明已更新");
  }

  function clearAlbumFromItem(item, albumId) {
    return item?.Customization?.AlbumId === albumId
      ? { ...item, Customization: { ...(item.Customization || {}), AlbumId: null } }
      : item;
  }
  function syncDeletedAlbumLocally(albumId) {
    if (selectedItem.value) selectedItem.value = clearAlbumFromItem(selectedItem.value, albumId);
    if (editDraft.AlbumId === albumId) editDraft.AlbumId = null;
    if (batchEdit.albumId === albumId) batchEdit.albumId = null;
    orderedItems.value = orderedItems.value.map((item) => clearAlbumFromItem(item, albumId));
    rebuildGalleryItemIndex();
    for (const group of galleryGroups.value) group.items = group.items.map((item) => galleryItemIndex.get(item.MediaId) || item);
    triggerRef(galleryGroups);
  }
  async function deleteAlbumGlobally(album) {
    const usage = Number(album?.UsageCount || 0);
    if (!window.confirm(`确定全局删除相册“${album.Title}”？这会清空 ${usage} 个媒体的相册字段。`)) return;
    const result = await api.deleteAlbumGlobally({ albumId: album.AlbumId });
    if (!result?.ok) { showToastMessage(`删除相册失败：${result?.error || "未知错误"}`); return; }
    applyAlbumRegistry(result.albums);
    syncDeletedAlbumLocally(album.AlbumId);
    if (query.filters.album === album.AlbumId) { query.filters.album = ""; await queryGallery(); }
    showToastMessage(`已全局删除相册“${album.Title}”`);
  }

  function resetAlbumState() {
    albumRegistry.value = [];
    Object.assign(albumSearch, { viewer: "", batch: "" });
    closeAllAlbumDropdowns(); closeCreateAlbumMenu();
    Object.assign(albumManager, { visible: false, search: "", editingId: "", editDescription: "", error: "" });
  }

  return {
    albumRegistry, albumSearch, albumDropdown, albumCreate, albumManager, managerFilteredAlbums,
    loadAlbums, getAlbumOptions, getAlbumDescription, getAlbumTitle, openAlbumDropdown,
    closeAlbumDropdown, closeAllAlbumDropdowns, setAlbumForTarget, clearAlbumForTarget,
    onAlbumSearchKeydown, openCreateAlbumMenu, closeCreateAlbumMenu, createAlbumAndSelect,
    openAlbumManager, closeAlbumManager, startAlbumDescriptionEdit, cancelAlbumDescriptionEdit,
    saveAlbumDescription, deleteAlbumGlobally, resetAlbumState,
  };
}
