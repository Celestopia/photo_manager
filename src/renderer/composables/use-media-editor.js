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
    Album: "",
    LocationPlace: "",
    LocationDetail: "",
    Tags: [],
    People: [],
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
    editDraft.Album = item?.Customization?.Album || "";
    editDraft.LocationPlace = item?.Location?.Place || item?.Location?.Site || "";
    editDraft.LocationDetail = item?.Location?.Detail || "";
    editDraft.Tags = [...(item?.Customization?.Tags || [])];
    editDraft.People = [...(item?.Customization?.People || [])];
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
    if (index < 0 || index >= editDraft.Tags.length) return;
    editDraft.Tags.splice(index, 1);
    requestEdit("Tags");
  }

  function removePersonAt(index) {
    if (index < 0 || index >= editDraft.People.length) return;
    editDraft.People.splice(index, 1);
    requestEdit("People");
  }

  function setRating(ratingValue) {
    const normalized = Math.min(5, Math.max(1, Number(ratingValue || 1)));
    if (normalized === editDraft.Rating) return;
    editDraft.Rating = normalized;
    requestEdit("Rating");
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
      filePath: selectedItem.value.FilePath,
      customization: {
        Title: editDraft.Title,
        Rating: Math.min(5, Math.max(1, Number(editDraft.Rating || 1))),
        Album: editDraft.Album,
        Tags: [...editDraft.Tags],
        People: [...editDraft.People],
        Description: editDraft.Description,
        HiddenDescription: editDraft.HiddenDescription,
      },
      location: { Place: editDraft.LocationPlace, Detail: editDraft.LocationDetail },
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
      Album: "",
      LocationPlace: "",
      LocationDetail: "",
      Tags: [],
      People: [],
      Description: "",
      HiddenDescription: "",
    });
  }

  watch(
    () => [
      editDraft.Title,
      editDraft.Rating,
      editDraft.Album,
      editDraft.LocationPlace,
      editDraft.LocationDetail,
      editDraft.Tags.join("\u0001"),
      editDraft.People.join("\u0001"),
      editDraft.Description,
      editDraft.HiddenDescription,
    ],
    () => {
      if (view.value !== "viewer") return;
      const compareTags = (selectedItem.value?.Customization?.Tags || []).join("\u0001");
      const comparePeople = (selectedItem.value?.Customization?.People || []).join("\u0001");
      editingDirty.value =
        editDraft.Title !== (selectedItem.value?.Customization?.Title || "")
        || Number(editDraft.Rating || 1) !== Number(selectedItem.value?.Customization?.Rating || 1)
        || editDraft.Album !== (selectedItem.value?.Customization?.Album || "")
        || editDraft.LocationPlace !== (selectedItem.value?.Location?.Place || selectedItem.value?.Location?.Site || "")
        || editDraft.LocationDetail !== (selectedItem.value?.Location?.Detail || "")
        || editDraft.Tags.join("\u0001") !== compareTags
        || editDraft.People.join("\u0001") !== comparePeople
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
    autoGrowFieldTextarea,
    autoGrowAllFieldTextareas,
    onFieldTextareaInput,
    cancelEdit,
    confirmEdit,
    resetEditorState,
  };
}
