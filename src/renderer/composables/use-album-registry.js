import { computed, reactive, ref, triggerRef } from "vue";

function normalizeAlbumTitle(value) {
  return String(value ?? "").trim();
}

/** Owns the single-valued album registry, picker state, and album-management workflow. */
export function useAlbumRegistry({
  api,
  unassignedAlbumFilter,
  filterOptions,
  query,
  editDraft,
  batchEdit,
  selectedItem,
  orderedItems,
  galleryGroups,
  gallerySettingsOpen,
  showToastMessage,
  closeOtherRegistryDropdowns,
  requestEdit,
  rebuildGalleryItemIndex,
  galleryItemIndex,
  queryGallery,
}) {
  const albumRegistry = ref([]);
  const albumSearch = reactive({ viewer: "", batch: "" });
  const albumDropdown = reactive({ viewer: false, batch: false });
  const albumCreate = reactive({ visible: false, target: "viewer", title: "", description: "", error: "" });
  const albumManager = reactive({ visible: false, search: "", editingTitle: "", editDescription: "", error: "" });

  const managerFilteredAlbums = computed(() => {
    const keyword = albumManager.search.trim();
    const source = [...albumRegistry.value].sort((a, b) => a.Title.localeCompare(b.Title, "zh-CN"));
    if (!keyword) return source;
    return source.filter((album) => album.Title.includes(keyword) || (album.Description || "").includes(keyword));
  });

  function applyAlbumRegistry(albums) {
    albumRegistry.value = (Array.isArray(albums) ? albums : [])
      .map((album) => ({
        Title: normalizeAlbumTitle(album?.Title),
        Description: normalizeAlbumTitle(album?.Description),
        CreatedAt: album?.CreatedAt || "",
        UpdatedAt: album?.UpdatedAt || "",
        UsageCount: Number(album?.UsageCount || 0),
      }))
      .filter((album) => album.Title);
    filterOptions.albums = albumRegistry.value.map((album) => album.Title);
    if (query.filters.album && query.filters.album !== unassignedAlbumFilter && !filterOptions.albums.includes(query.filters.album)) {
      query.filters.album = "";
    }
  }

  async function loadAlbums() {
    if (typeof api.listAlbums !== "function") return;
    const result = await api.listAlbums();
    if (result?.ok) applyAlbumRegistry(result.albums);
  }

  function selectedAlbumForTarget(target) {
    return target === "batch" ? batchEdit.album : editDraft.Album;
  }

  function getAlbumOptions(target) {
    const keyword = normalizeAlbumTitle(albumSearch[target]);
    const selected = selectedAlbumForTarget(target);
    return albumRegistry.value
      .filter((album) => !keyword || album.Title.includes(keyword) || (album.Description || "").includes(keyword))
      .sort((a, b) => Number(b.Title === selected) - Number(a.Title === selected) || a.Title.localeCompare(b.Title, "zh-CN"))
      .slice(0, 50);
  }

  function getAlbumDescription(albumTitle) {
    return albumRegistry.value.find((album) => album.Title === albumTitle)?.Description || "";
  }

  function openAlbumDropdown(target) {
    const shouldOpen = !albumDropdown[target];
    closeOtherRegistryDropdowns?.();
    albumDropdown[target] = shouldOpen;
  }

  function closeAlbumDropdown(target) { albumDropdown[target] = false; }

  function closeAllAlbumDropdowns() {
    albumDropdown.viewer = false;
    albumDropdown.batch = false;
  }

  function setAlbumForTarget(target, rawTitle) {
    const title = normalizeAlbumTitle(rawTitle);
    if (!title) return;
    if (target === "batch") batchEdit.album = title;
    else {
      editDraft.Album = title;
      requestEdit("Album");
    }
    albumSearch[target] = "";
    closeAlbumDropdown(target);
  }

  function clearAlbumForTarget(target) {
    if (target === "batch") batchEdit.album = "";
    else {
      editDraft.Album = "";
      requestEdit("Album");
    }
    albumSearch[target] = "";
    closeAlbumDropdown(target);
  }

  function onAlbumSearchKeydown(event, target) {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = getAlbumOptions(target)[0];
      if (first) setAlbumForTarget(target, first.Title);
      return;
    }
    if (event.key === "Escape") {
      closeAlbumDropdown(target);
      return;
    }
    if (event.key === "Backspace" && !albumSearch[target] && selectedAlbumForTarget(target)) {
      event.preventDefault();
      clearAlbumForTarget(target);
    }
  }

  function openCreateAlbumMenu(target) {
    closeOtherRegistryDropdowns?.();
    Object.assign(albumCreate, {
      visible: true,
      target,
      title: target === "manager" ? "" : normalizeAlbumTitle(albumSearch[target]),
      description: "",
      error: "",
    });
    if (target !== "manager") closeAlbumDropdown(target);
  }

  function closeCreateAlbumMenu() {
    Object.assign(albumCreate, { visible: false, title: "", description: "", error: "" });
  }

  async function createAlbumAndSelect() {
    const title = normalizeAlbumTitle(albumCreate.title);
    const description = normalizeAlbumTitle(albumCreate.description);
    if (!title || !description) {
      albumCreate.error = "相册名称和说明不能为空";
      return;
    }
    const result = await api.createAlbum({ title, description });
    if (!result?.ok) {
      albumCreate.error = result?.error || "创建相册失败";
      return;
    }
    applyAlbumRegistry(result.albums);
    const target = albumCreate.target;
    if (target === "manager") showToastMessage(`已创建相册“${result.album.Title}”`);
    else setAlbumForTarget(target, result.album.Title);
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
    Object.assign(albumManager, { visible: false, search: "", editingTitle: "", editDescription: "", error: "" });
  }

  function startAlbumDescriptionEdit(album) {
    Object.assign(albumManager, { editingTitle: album.Title, editDescription: album.Description || "", error: "" });
  }

  function cancelAlbumDescriptionEdit() {
    Object.assign(albumManager, { editingTitle: "", editDescription: "", error: "" });
  }

  async function saveAlbumDescription() {
    const title = albumManager.editingTitle;
    const description = normalizeAlbumTitle(albumManager.editDescription);
    if (!title || !description) {
      albumManager.error = "说明不能为空";
      return;
    }
    const result = await api.updateAlbumDescription({ title, description });
    if (!result?.ok) {
      albumManager.error = result?.error || "保存说明失败";
      return;
    }
    applyAlbumRegistry(result.albums);
    cancelAlbumDescriptionEdit();
    showToastMessage("相册说明已更新");
  }

  function clearAlbumFromItem(item, albumTitle) {
    if (normalizeAlbumTitle(item?.Customization?.Album) !== albumTitle) return item;
    return { ...item, Customization: { ...(item.Customization || {}), Album: "" } };
  }

  function syncDeletedAlbumLocally(albumTitle) {
    if (selectedItem.value) selectedItem.value = clearAlbumFromItem(selectedItem.value, albumTitle);
    if (editDraft.Album === albumTitle) editDraft.Album = "";
    if (batchEdit.album === albumTitle) batchEdit.album = "";
    orderedItems.value = orderedItems.value.map((item) => clearAlbumFromItem(item, albumTitle));
    rebuildGalleryItemIndex();
    for (const group of galleryGroups.value) {
      group.items = group.items.map((item) => galleryItemIndex.get(item.FilePath) || item);
    }
    triggerRef(galleryGroups);
  }

  async function deleteAlbumGlobally(album) {
    const usage = Number(album?.UsageCount || 0);
    if (!window.confirm(`确定全局删除相册“${album.Title}”？这会清空 ${usage} 个媒体的相册字段。`)) return;
    const result = await api.deleteAlbumGlobally({ title: album.Title });
    if (!result?.ok) {
      showToastMessage(`删除相册失败：${result?.error || "未知错误"}`);
      return;
    }
    applyAlbumRegistry(result.albums);
    syncDeletedAlbumLocally(album.Title);
    if (query.filters.album === album.Title) {
      query.filters.album = "";
      await queryGallery();
    }
    showToastMessage(`已全局删除相册“${album.Title}”`);
  }

  function resetAlbumState() {
    albumRegistry.value = [];
    Object.assign(albumSearch, { viewer: "", batch: "" });
    closeAllAlbumDropdowns();
    closeCreateAlbumMenu();
    Object.assign(albumManager, { visible: false, search: "", editingTitle: "", editDescription: "", error: "" });
  }

  return {
    albumRegistry,
    albumSearch,
    albumDropdown,
    albumCreate,
    albumManager,
    managerFilteredAlbums,
    loadAlbums,
    getAlbumOptions,
    getAlbumDescription,
    openAlbumDropdown,
    closeAlbumDropdown,
    closeAllAlbumDropdowns,
    setAlbumForTarget,
    clearAlbumForTarget,
    onAlbumSearchKeydown,
    openCreateAlbumMenu,
    closeCreateAlbumMenu,
    createAlbumAndSelect,
    openAlbumManager,
    closeAlbumManager,
    startAlbumDescriptionEdit,
    cancelAlbumDescriptionEdit,
    saveAlbumDescription,
    deleteAlbumGlobally,
    resetAlbumState,
  };
}
