import { nextTick, reactive, ref, watch } from "vue";

/** Owns the customization draft, dirty tracking, field sizing, and metadata save transaction. */
export function useMediaEditor({
  api,
  view,
  selectedItem,
  saveNotice,
  showSaveNotice,
  showToastMessage,
  resetViewerPickers,
  syncUpdatedItems,
  refreshRegistries,
}) {
  const editDraft = reactive({
    Title: "",
    Rating: 1,
    Privacy: 1,
    AlbumId: null,
    LocationId: null,
    LocationDetail: "",
    TagIds: [],
    PersonIds: [],
    Description: "",
    HiddenDescription: "",
  });
  const editingDirty = ref(false);
  const activeEditField = ref("");

  function autoGrowFieldTextarea(element) {
    if (!element) return;
    const minHeight = 28;
    element.style.height = "auto";
    element.style.height = `${Math.max(minHeight, element.scrollHeight)}px`;
  }

  function autoGrowAllFieldTextareas() {
    for (const node of document.querySelectorAll(".field-textarea")) autoGrowFieldTextarea(node);
  }

  function setDraftFromItem(item, keepActiveField = false) {
    editDraft.Title = item?.Customization?.Title || "";
    editDraft.Rating = Number(item?.Customization?.Rating || 1);
    editDraft.Privacy = Number(item?.Customization?.Privacy ?? 1);
    editDraft.AlbumId = item?.Customization?.AlbumId || null;
    editDraft.LocationId = item?.Location?.LocationId || null;
    editDraft.LocationDetail = item?.Location?.Detail || "";
    editDraft.TagIds = [...(item?.Customization?.TagIds || [])];
    editDraft.PersonIds = [...(item?.Customization?.PersonIds || [])];
    editDraft.Description = item?.Customization?.Description || "";
    editDraft.HiddenDescription = item?.Customization?.HiddenDescription || "";
    resetViewerPickers?.();
    editingDirty.value = false;
    if (!keepActiveField) activeEditField.value = "";
    nextTick(autoGrowAllFieldTextareas);
  }

  function requestEdit(field) {
    editingDirty.value = true;
    if (field) activeEditField.value = field;
  }

  function removeTagAt(index) {
    if (index < 0 || index >= editDraft.TagIds.length) return;
    editDraft.TagIds.splice(index, 1);
    requestEdit("Tags");
  }

  function removePersonAt(index) {
    if (index < 0 || index >= editDraft.PersonIds.length) return;
    editDraft.PersonIds.splice(index, 1);
    requestEdit("People");
  }

  function setRating(ratingValue) {
    const normalized = Math.min(5, Math.max(1, Number(ratingValue || 1)));
    if (normalized === editDraft.Rating) return;
    editDraft.Rating = normalized;
    requestEdit("Rating");
  }

  function setPrivacy(privacyValue) {
    const normalized = Number(privacyValue);
    if (!Number.isInteger(normalized) || normalized < 1 || normalized > 5 || normalized === editDraft.Privacy) return;
    editDraft.Privacy = normalized;
    requestEdit("Privacy");
  }

  function onFieldTextareaInput(event, field) {
    autoGrowFieldTextarea(event.target);
    requestEdit(field);
  }

  function cancelEdit() {
    saveNotice.visible = false;
    saveNotice.field = "";
    setDraftFromItem(selectedItem.value);
  }

  async function confirmEdit() {
    if (!selectedItem.value) return;
    const saveField = activeEditField.value || "Title";
    const payload = {
      mediaId: selectedItem.value.MediaId,
      customization: {
        Title: editDraft.Title,
        Rating: Math.min(5, Math.max(1, Number(editDraft.Rating || 1))),
        Privacy: editDraft.Privacy,
        AlbumId: editDraft.AlbumId,
        TagIds: [...editDraft.TagIds],
        PersonIds: [...editDraft.PersonIds],
        Description: editDraft.Description,
        HiddenDescription: editDraft.HiddenDescription,
      },
      location: { LocationId: editDraft.LocationId, Detail: editDraft.LocationDetail },
    };
    const result = await api.updateCustomization(payload);
    if (result.ok) {
      selectedItem.value = result.item;
      syncUpdatedItems?.([result.item]);
      setDraftFromItem(result.item, true);
      activeEditField.value = saveField;
      showSaveNotice("已修改", saveField);
      await refreshRegistries?.();
    } else {
      showToastMessage(`修改失败：${result?.error || "未知错误"}`);
    }
  }

  function resetEditorState() {
    editingDirty.value = false;
    activeEditField.value = "";
    Object.assign(editDraft, {
      Title: "",
      Rating: 1,
      Privacy: 1,
      AlbumId: null,
      LocationId: null,
      LocationDetail: "",
      TagIds: [],
      PersonIds: [],
      Description: "",
      HiddenDescription: "",
    });
  }

  watch(
    () => [
      editDraft.Title,
      editDraft.Rating,
      editDraft.Privacy,
      editDraft.AlbumId,
      editDraft.LocationId,
      editDraft.LocationDetail,
      editDraft.TagIds.join("\u0001"),
      editDraft.PersonIds.join("\u0001"),
      editDraft.Description,
      editDraft.HiddenDescription,
    ],
    () => {
      if (view.value !== "viewer") return;
      const compareTags = (selectedItem.value?.Customization?.TagIds || []).join("\u0001");
      const comparePeople = (selectedItem.value?.Customization?.PersonIds || []).join("\u0001");
      editingDirty.value =
        editDraft.Title !== (selectedItem.value?.Customization?.Title || "")
        || Number(editDraft.Rating || 1) !== Number(selectedItem.value?.Customization?.Rating || 1)
        || editDraft.Privacy !== selectedItem.value?.Customization?.Privacy
        || editDraft.AlbumId !== (selectedItem.value?.Customization?.AlbumId || null)
        || editDraft.LocationId !== (selectedItem.value?.Location?.LocationId || null)
        || editDraft.LocationDetail !== (selectedItem.value?.Location?.Detail || "")
        || editDraft.TagIds.join("\u0001") !== compareTags
        || editDraft.PersonIds.join("\u0001") !== comparePeople
        || editDraft.Description !== (selectedItem.value?.Customization?.Description || "")
        || editDraft.HiddenDescription !== (selectedItem.value?.Customization?.HiddenDescription || "");
    },
  );

  return {
    editDraft,
    editingDirty,
    activeEditField,
    setDraftFromItem,
    requestEdit,
    removeTagAt,
    removePersonAt,
    setRating,
    setPrivacy,
    autoGrowFieldTextarea,
    autoGrowAllFieldTextareas,
    onFieldTextareaInput,
    cancelEdit,
    confirmEdit,
    resetEditorState,
  };
}
