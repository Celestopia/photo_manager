<template>
  <div class="app-shell">
    <GalleryView v-if="view === 'gallery'" />
    <ViewerView v-else />
    <div class="copy-toast" v-if="toast.visible">{{ toast.message }}</div>
    <div
      class="dynamic-tooltip"
      v-if="dynamicTooltip.visible"
      ref="dynamicTooltipRef"
      :style="{ left: dynamicTooltip.x + 'px', top: dynamicTooltip.y + 'px' }"
    >{{ dynamicTooltip.text }}</div>
  </div>
</template>

<script>
import { reactive, ref, computed, onMounted, onBeforeUnmount, watch, nextTick, provide } from "vue";
import GalleryView from "./components/GalleryView.vue";
import ViewerView from "./components/ViewerView.vue";

/**
 * Root renderer component in Single File Component format.
 * It is shared by both Electron mode and browser preview mode.
 */
const API = window.photoManagerApi;
if (!API) {
  const root = document.getElementById("app");
  if (root) {
    root.innerHTML =
      "<div style=\"padding:24px;font-family:Microsoft YaHei, sans-serif;color:#173756;\">初始化失败：未检测到 photoManagerApi。请使用 Electron 启动，或通过 browser.html + 本地HTTP服务启动浏览器预览模式。</div>";
  }
  throw new Error("photoManagerApi is not available");
}

const WINDOW_ACTIONS = {
  minimize: "minimize",
  maximize: "maximize",
  restore: "restore",
  close: "close",
};

const ICONS = {
  gallery: new URL("./assets/gallery.svg", import.meta.url).href,
  windowMinimize: new URL("./assets/window_minimize.svg", import.meta.url).href,
  windowMaximize: new URL("./assets/window_maximize.svg", import.meta.url).href,
  windowRestore: new URL("./assets/window_restore.svg", import.meta.url).href,
  windowClose: new URL("./assets/window_close.svg", import.meta.url).href,
  metadataInfo: new URL("./assets/metadata_info.svg", import.meta.url).href,
  zoomIn: new URL("./assets/image_zoom_in.svg", import.meta.url).href,
  zoomOut: new URL("./assets/image_zoom_out.svg", import.meta.url).href,
  rotateClockwise: new URL("./assets/image_rotate_clockwise.svg", import.meta.url).href,
  rotateCounterclockwise: new URL("./assets/image_rotate_counterclockwise.svg", import.meta.url).href,
  mirror: new URL("./assets/image_mirror.svg", import.meta.url).href,
  restoreView: new URL("./assets/image_restore_view.svg", import.meta.url).href,
  fullscreen: new URL("./assets/image_fullscreen.svg", import.meta.url).href,
  customization: new URL("./assets/customization.svg", import.meta.url).href,
};

// Human-readable file-size formatter for side panels.
/**
 * Convert raw byte size into readable KB/MB/GB text for UI display.
 */
function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Resolve image source for both filesystem URLs (Electron) and HTTP paths (web preview).
/**
 * Build a valid image URL for both local file paths (Electron) and web preview HTTP paths.
 */
function buildImageUrl(absolutePath) {
  if (!absolutePath) return "";
  if (absolutePath.startsWith("http://") || absolutePath.startsWith("https://") || absolutePath.startsWith("/")) {
    return absolutePath;
  }
  const normalized = absolutePath.replace(/\\/g, "/");
  return `file:///${encodeURI(normalized)}`;
}


export default {
  name: "PhotoManagerApp",
  components: {
    GalleryView,
    ViewerView,
  },
  setup() {
    // --- Core view / query state ---
    const config = ref(null);
    const view = ref("gallery");

    const query = reactive({
      page: 1,
      pageSize: 120,
      sortBy: "shootingTime",
      sortOrder: "desc",
      filters: { album: "", tag: "" },
      search: { field: "title", value: "" },
    });

    const galleryGroups = ref([]);
    const total = ref(0);
    const hasMore = ref(false);
    const loading = ref(false);
    const filterOptions = reactive({ albums: [], tags: [] });

    // --- Selection state ---
    const selectedItem = ref(null);
    const selectedGlobalIndex = ref(-1);
    const orderedItems = ref([]);
    const isSelectionMode = ref(false);
    const gallerySelection = ref(new Set());
    const batchEdit = reactive({
      title: "",
      tags: [],
      pendingTagInput: "",
      locationCountry: "",
      locationProvince: "",
      locationCity: "",
      locationSite: "",
    });
    const batchStatus = reactive({ visible: false, tone: "info", message: "" });
    const selectedGalleryCount = computed(() => gallerySelection.value.size);
    const batchHasChanges = computed(() => {
      if (batchEdit.title.trim()) return true;
      if (batchEdit.tags.length) return true;
      if (batchEdit.locationCountry.trim()) return true;
      if (batchEdit.locationProvince.trim()) return true;
      if (batchEdit.locationCity.trim()) return true;
      if (batchEdit.locationSite.trim()) return true;
      return false;
    });
    const canApplyBatchEdit = computed(() => selectedGalleryCount.value > 0 && batchHasChanges.value);

    // --- Viewer transform state ---
    const zoomPercent = ref(100);
    const rotateDeg = ref(0);
    const mirror = ref(false);
    const pan = reactive({ x: 0, y: 0 });
    const dragging = reactive({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });
    const showContextMenu = ref(false);
    const contextPosition = reactive({ x: 0, y: 0 });
    const showPrivateNote = ref(false);
    const showLocationInfoMenu = ref(false);
    const showLeftPanel = ref(true);
    const showRightPanel = ref(true);
    const imageStageRef = ref(null);
    const isWindowMaximized = ref(false);
    const toast = reactive({ visible: false, message: "" });
    const saveNotice = reactive({ visible: false, message: "", field: "" });
    const dynamicTooltip = reactive({ visible: false, text: "", x: 0, y: 0 });
    const dynamicTooltipRef = ref(null);
    let toastTimer = null;
    let saveNoticeTimer = null;
    let tooltipTimer = null;
    let tooltipTarget = null;
    let removeWindowStateListener = null;

    // --- Editable draft model ---
    const editDraft = reactive({
      Title: "",
      Rating: 1,
      Album: "",
      LocationSite: "",
      Tags: [],
      Description: "",
      HiddenDescription: "",
    });
    const pendingTagInput = ref("");
    const editingDirty = ref(false);
    const activeEditField = ref("");
    const STAR_LEVELS = [1, 2, 3, 4, 5];

    // Zoom limits are config-driven.
    const minZoom = computed(() => config.value?.ui?.viewer?.zoom?.minPercent ?? 10);
    const maxZoom = computed(() => config.value?.ui?.viewer?.zoom?.maxPercent ?? 1000);
    const zoomStep = computed(() => config.value?.ui?.viewer?.zoom?.stepPercent ?? 10);

    // Three-column ratio in viewer is config-driven.
    const ratioStyle = computed(() => {
      const ratio = config.value?.ui?.viewer?.panelRatio || { left: 1, center: 2, right: 1 };
      const left = showLeftPanel.value ? ratio.left : 0;
      const right = showRightPanel.value ? ratio.right : 0;
      return { gridTemplateColumns: `${left}fr ${ratio.center}fr ${right}fr` };
    });

    const viewerHeaderTime = computed(() => {
      const raw = selectedItem.value?.FileSystem?.ShootingTimeString || "";
      const match = raw.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/);
      if (!match) return "-";
      const year = match[1];
      const month = String(Number(match[2])).padStart(2, "0");
      const day = String(Number(match[3])).padStart(2, "0");
      const hour = String(Number(match[4])).padStart(2, "0");
      const minute = String(Number(match[5])).padStart(2, "0");
      const second = String(Number(match[6])).padStart(2, "0");
      return `${year} 年 ${month} 月 ${day} 日 ${hour}:${minute}:${second}`;
    });
    const windowToggleTip = computed(() => (isWindowMaximized.value ? "还原" : "最大化"));
    const windowToggleIcon = computed(() => (isWindowMaximized.value ? ICONS.windowRestore : ICONS.windowMaximize));

    const viewerImageStyle = computed(() => ({
      transform:
        `translate(${pan.x}px, ${pan.y}px) ` +
        `scale(${zoomPercent.value / 100}) ` +
        `rotate(${rotateDeg.value}deg) ` +
        `scaleX(${mirror.value ? -1 : 1})`,
      transition: dragging.active ? "none" : "transform 90ms linear",
    }));

    /**

     * Load runtime config through bridge API and initialize UI defaults such as page size and panel visibility.

     */

    
    // ============================================================================
    // Configuration and Viewer Draft Initialization
    // ============================================================================
    async function loadConfig() {
      // Load runtime config once; gallery page size can be customized by config.yml.
      config.value = await API.getConfig();
      query.pageSize = config.value?.ui?.gallery?.pageSize || 120;
      showLeftPanel.value = config.value?.ui?.viewer?.panels?.showLeft ?? true;
      showRightPanel.value = config.value?.ui?.viewer?.panels?.showRight ?? true;
    }

    // Reset transform each time we enter viewer or switch image.
    /**
     * Reset viewer transform state (zoom/rotation/mirror/pan) when opening or switching photos.
     */
    function resetPanZoom() {
      zoomPercent.value = 100;
      rotateDeg.value = 0;
      mirror.value = false;
      pan.x = 0;
      pan.y = 0;
    }

    // Pull metadata values into editable text fields.
    /**
     * Copy selected item metadata into editable draft fields used by the right-side customization panel.
     */
    function setDraftFromItem(item, keepActiveField = false) {
      editDraft.Title = item?.Customization?.Title || "";
      editDraft.Rating = Number(item?.Customization?.Rating || 1);
      editDraft.Album = item?.Customization?.Album || "";
      editDraft.LocationSite = item?.Location?.Site || "";
      editDraft.Tags = [...(item?.Customization?.Tags || [])];
      editDraft.Description = item?.Customization?.Description || "";
      editDraft.HiddenDescription = item?.Customization?.HiddenDescription || "";
      pendingTagInput.value = "";
      editingDirty.value = false;
      if (!keepActiveField) activeEditField.value = "";
      nextTick(() => autoGrowAllFieldTextareas());
    }

    /**

     * Show bottom toast message for short user feedback and auto-hide it after a timeout.

     */

    function showToastMessage(message) {
      toast.message = message;
      toast.visible = true;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.visible = false;
      }, 1800);
    }

    /**

     * Show field-level save confirmation message right below the edited field.

     */

    function showSaveNotice(message, field) {
      saveNotice.message = message;
      saveNotice.field = field || "";
      saveNotice.visible = true;
      if (saveNoticeTimer) clearTimeout(saveNoticeTimer);
      saveNoticeTimer = setTimeout(() => {
        saveNotice.visible = false;
        saveNotice.field = "";
      }, 1800);
    }

    /**

     * Hide tooltip immediately and clear any delayed show timer.

     */

    
    // ============================================================================
    // Tooltip Visibility and Smart Positioning
    // ============================================================================
    function hideDynamicTooltip() {
      dynamicTooltip.visible = false;
      if (tooltipTimer) {
        clearTimeout(tooltipTimer);
        tooltipTimer = null;
      }
    }

    /**

     * Compute adaptive tooltip coordinates so it stays inside viewport bounds.

     */

    async function positionDynamicTooltip(target) {
      if (!target || !dynamicTooltip.visible || !dynamicTooltipRef.value) return;
      const rect = target.getBoundingClientRect();
      const tipRect = dynamicTooltipRef.value.getBoundingClientRect();
      const margin = 8;
      let x = rect.left + rect.width / 2 - tipRect.width / 2;
      x = Math.max(margin, Math.min(x, window.innerWidth - tipRect.width - margin));

      const preferTop = rect.top - tipRect.height - 10;
      const preferBottom = rect.bottom + 10;
      let y = preferTop;
      if (preferTop < margin) y = preferBottom;
      if (y + tipRect.height > window.innerHeight - margin) {
        y = Math.max(margin, rect.top - tipRect.height - 10);
      }

      dynamicTooltip.x = x;
      dynamicTooltip.y = y;
    }

    /**

     * Delay tooltip display by 0.5s and bind it to current hovered icon button.

     */

    function scheduleDynamicTooltip(target) {
      hideDynamicTooltip();
      tooltipTarget = target;
      tooltipTimer = setTimeout(async () => {
        if (!tooltipTarget) return;
        dynamicTooltip.text = tooltipTarget.dataset.tip || "";
        if (!dynamicTooltip.text) return;
        dynamicTooltip.visible = true;
        await nextTick();
        await positionDynamicTooltip(tooltipTarget);
      }, 500);
    }

    /**

     * Start tooltip scheduling when pointer enters an icon button with data-tip text.

     */

    function onTooltipMouseOver(event) {
      const target = event.target.closest(".icon-btn[data-tip]");
      if (!target) return;
      if (target === tooltipTarget && dynamicTooltip.visible) return;
      scheduleDynamicTooltip(target);
    }

    /**

     * Cancel tooltip when pointer leaves the tracked icon target.

     */

    function onTooltipMouseOut(event) {
      const leaving = event.target.closest?.(".icon-btn[data-tip]");
      if (!leaving) return;
      if (leaving !== tooltipTarget) return;
      const related = event.relatedTarget;
      if (related && leaving.contains(related)) return;
      tooltipTarget = null;
      hideDynamicTooltip();
    }

    /**

     * Force-hide tooltip on global interactions like click/scroll/context changes.

     */

    function onTooltipGlobalHide() {
      tooltipTarget = null;
      hideDynamicTooltip();
    }

    /**

     * Reposition currently visible tooltip after resize/scroll/layout changes.

     */

    async function onTooltipViewportChange() {
      if (!dynamicTooltip.visible || !tooltipTarget) return;
      await nextTick();
      await positionDynamicTooltip(tooltipTarget);
    }

    /**

     * Add one tag from pending input into current draft with duplicate validation.

     */

    function addTag() {
      const tag = pendingTagInput.value.trim();
      if (!tag) return;
      if (editDraft.Tags.includes(tag)) {
        showToastMessage(`标签“${tag}”已存在，添加失败`);
        pendingTagInput.value = "";
        return;
      }
      editDraft.Tags.push(tag);
      requestEdit("Tags");
      pendingTagInput.value = "";
    }

    /**

     * Enable gallery selection mode for multi-select and batch editing.

     */

    
    // ============================================================================
    // Gallery Selection and Batch Edit Workflow
    // ============================================================================
    function enterSelectionMode() {
      isSelectionMode.value = true;
    }

    /**

     * Exit selection mode and reset selection/batch editor temporary state.

     */

    function exitSelectionMode() {
      isSelectionMode.value = false;
      clearGallerySelection();
      clearBatchEditInputs();
    }

    /**

     * Handle gallery card click: toggle selection in selection mode, otherwise open viewer.

     */

    function onGalleryCardClick(item) {
      if (isSelectionMode.value) {
        toggleGallerySelection(item.FilePath);
        return;
      }
      openViewer(item);
    }

    /**

     * Check whether a gallery item is currently selected for batch operations.

     */

    function isGallerySelected(filePath) {
      return gallerySelection.value.has(filePath);
    }

    /**

     * Toggle one FilePath in selection set while keeping state immutable for Vue reactivity.

     */

    function toggleGallerySelection(filePath) {
      const next = new Set(gallerySelection.value);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      gallerySelection.value = next;
    }

    /**

     * Clear all selected gallery items.

     */

    function clearGallerySelection() {
      gallerySelection.value = new Set();
    }

    /**

     * Select every currently loaded gallery item in selection mode.

     */

    function selectAllGalleryPhotos() {
      if (!isSelectionMode.value) return;
      const all = orderedItems.value.map((item) => item.FilePath).filter(Boolean);
      gallerySelection.value = new Set(all);
    }

    /**

     * Drop selected items that are no longer present after query/filter/page refresh.

     */

    function syncGallerySelectionWithLoadedItems() {
      const available = new Set(orderedItems.value.map((item) => item.FilePath));
      const next = new Set([...gallerySelection.value].filter((filePath) => available.has(filePath)));
      if (next.size !== gallerySelection.value.size) {
        gallerySelection.value = next;
      }
    }

    /**

     * Add a tag to batch-edit pending tag list, preventing duplicates in the pending set.

     */

    function addBatchTag() {
      const tag = batchEdit.pendingTagInput.trim();
      if (!tag) return;
      if (batchEdit.tags.includes(tag)) {
        showToastMessage(`标签“${tag}”已存在于待添加列表，添加失败`);
        batchEdit.pendingTagInput = "";
        return;
      }
      batchEdit.tags.push(tag);
      batchEdit.pendingTagInput = "";
    }

    /**

     * Update batch panel status message and semantic tone (info/success/warning/error).

     */

    function setBatchStatus(tone, message) {
      batchStatus.visible = true;
      batchStatus.tone = tone;
      batchStatus.message = message;
    }

    /**

     * Reset all batch-edit form inputs, optionally keeping current status message visible.

     */

    function clearBatchEditInputs({ keepStatus = false } = {}) {
      batchEdit.title = "";
      batchEdit.tags = [];
      batchEdit.pendingTagInput = "";
      batchEdit.locationCountry = "";
      batchEdit.locationProvince = "";
      batchEdit.locationCity = "";
      batchEdit.locationSite = "";
      if (!keepStatus) {
        batchStatus.visible = false;
        batchStatus.message = "";
      }
    }

    /**

     * Patch updated metadata items back into gallery groups and flattened order cache.

     */

    function syncUpdatedItemsIntoGallery(updatedItems) {
      const byPath = new Map(updatedItems.map((item) => [item.FilePath, item]));
      orderedItems.value = orderedItems.value.map((item) => byPath.get(item.FilePath) || item);
      for (const group of galleryGroups.value) {
        group.items = group.items.map((item) => byPath.get(item.FilePath) || item);
      }
    }

    /**

     * Remove one pending batch tag by index.

     */

    function removeBatchTagAt(index) {
      if (index < 0 || index >= batchEdit.tags.length) return;
      batchEdit.tags.splice(index, 1);
    }

    /**

     * Implement Bilibili-style batch tag input behavior (Enter add, Backspace remove last).

     */

    function onBatchTagInputKeydown(event) {
      if (event.key === "Enter") {
        event.preventDefault();
        addBatchTag();
        return;
      }
      if (event.key === "Backspace" && !batchEdit.pendingTagInput) {
        event.preventDefault();
        removeBatchTagAt(batchEdit.tags.length - 1);
      }
    }

    /**

     * Build batch patch payload, call API, handle partial success, and sync updated items locally.

     */

    async function applyBatchEdit() {
      const filePaths = [...gallerySelection.value];
      if (!filePaths.length) {
        showToastMessage("请先选择图片");
        return;
      }

      const locationPatch = {};
      if (batchEdit.locationCountry.trim()) locationPatch.Country = batchEdit.locationCountry.trim();
      if (batchEdit.locationProvince.trim()) locationPatch.Province = batchEdit.locationProvince.trim();
      if (batchEdit.locationCity.trim()) locationPatch.City = batchEdit.locationCity.trim();
      if (batchEdit.locationSite.trim()) locationPatch.Site = batchEdit.locationSite.trim();
      const customizationPatch = {};
      if (batchEdit.title.trim()) customizationPatch.Title = batchEdit.title.trim();

      const addTags = [...new Set(batchEdit.tags.map((x) => x.trim()).filter(Boolean))];
      if (!addTags.length && !Object.keys(locationPatch).length && !Object.keys(customizationPatch).length) {
        showToastMessage("请先填写要批量修改的内容");
        return;
      }

      const result = await API.batchUpdateMetadata({
        filePaths,
        addTags,
        locationPatch,
        customizationPatch,
      });
      if (!result?.ok) {
        const message = `批量修改失败：${result?.error || "未知错误"}`;
        showToastMessage(message);
        setBatchStatus("error", message);
        return;
      }

      const updatedItems = Array.isArray(result.items) ? result.items : [];
      syncUpdatedItemsIntoGallery(updatedItems);
      const updatedCount = Number(result.updatedCount || updatedItems.length || 0);
      const missingCount = Number(result.missingCount || 0);
      const requestedCount = Number(result.requestedCount || filePaths.length || 0);
      const detail = missingCount > 0
        ? `批量修改完成：成功 ${updatedCount} 张，失败 ${missingCount} 张（请求 ${requestedCount} 张）`
        : `批量修改完成：成功 ${updatedCount} 张`;
      showToastMessage(detail);
      clearBatchEditInputs({ keepStatus: true });
      setBatchStatus(missingCount > 0 ? "warning" : "success", detail);
    }

    /**

     * Remove one tag from single-photo draft and mark tag field as pending save.

     */

    
    // ============================================================================
    // Single-Photo Tag and Rating Editing
    // ============================================================================
    function removeTagAt(index) {
      if (index < 0 || index >= editDraft.Tags.length) return;
      editDraft.Tags.splice(index, 1);
      requestEdit("Tags");
    }

    /**

     * Set star rating in draft and mark Rating field dirty when value changes.

     */

    function setRating(ratingValue) {
      const normalized = Math.min(5, Math.max(1, Number(ratingValue || 1)));
      if (normalized === editDraft.Rating) return;
      editDraft.Rating = normalized;
      requestEdit("Rating");
    }

    /**

     * Handle single-photo tag input keyboard behavior (Enter add, Backspace delete last).

     */

    function onTagInputKeydown(event) {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        addTag();
        return;
      }
      if (event.key === "Backspace" && !pendingTagInput.value) {
        event.preventDefault();
        removeTagAt(editDraft.Tags.length - 1);
      }
    }

    /**

     * Fetch gallery page from backend based on current search/filter/sort/pagination settings.

     */

    
    // ============================================================================
    // Gallery Query, Search, Filter, Sort, and Pagination
    // ============================================================================
    async function queryGallery(reset = false) {
      if (loading.value) return;
      loading.value = true;
      try {
        if (reset) query.page = 1;
        // Send plain objects instead of reactive proxies over IPC.
        const safeQuery = {
          page: query.page,
          pageSize: query.pageSize,
          sortBy: query.sortBy,
          sortOrder: query.sortOrder,
          filters: {
            album: query.filters.album,
            tag: query.filters.tag,
          },
          search: {
            field: query.search.field,
            value: query.search.value,
          },
        };
        const res = await API.queryGallery(safeQuery);
        total.value = res.total;
        hasMore.value = res.hasMore;
        filterOptions.albums = res.filterOptions.albums;
        filterOptions.tags = res.filterOptions.tags;

        if (query.page === 1) {
          // First page replaces existing gallery snapshot.
          galleryGroups.value = res.groups;
        } else {
          // Subsequent pages append by date group.
          for (const incomingGroup of res.groups) {
            const existing = galleryGroups.value.find((g) => g.date === incomingGroup.date);
            if (existing) existing.items.push(...incomingGroup.items);
            else galleryGroups.value.push(incomingGroup);
          }
        }

        orderedItems.value = galleryGroups.value.flatMap((g) => g.items);
        syncGallerySelectionWithLoadedItems();
      } finally {
        loading.value = false;
      }
    }

    /**

     * Load next gallery page when user clicks the load-more button.

     */

    async function loadMore() {
      if (!hasMore.value || loading.value) return;
      query.page += 1;
      await queryGallery(false);
    }

    /**

     * Re-query gallery from first page using current search form values.

     */

    async function applySearch() { await queryGallery(true); }
    /**
     * Re-query gallery from first page after filter/sort controls changed.
     */
    async function applyFilterSort() { await queryGallery(true); }

    // Restore default query + filter + sort state.
    /**
     * Restore gallery query controls to default state and reload first page data.
     */
    async function resetAll() {
      query.filters.album = "";
      query.filters.tag = "";
      query.search.field = "title";
      query.search.value = "";
      query.sortBy = "shootingTime";
      query.sortOrder = "desc";
      exitSelectionMode();
      await queryGallery(true);
    }

    /**

     * Switch to viewer mode for selected item and initialize draft/transform/index state.

     */

    
    // ============================================================================
    // Viewer Mode Navigation and Image Transform Controls
    // ============================================================================
    function openViewer(item) {
      selectedItem.value = item;
      selectedGlobalIndex.value = orderedItems.value.findIndex((x) => x.FilePath === item.FilePath);
      setDraftFromItem(item);
      showLocationInfoMenu.value = false;
      resetPanZoom();
      view.value = "viewer";
    }

    /**

     * Return from viewer mode to gallery and close transient overlays/menus.

     */

    function closeViewer() {
      view.value = "gallery";
      showContextMenu.value = false;
      showLocationInfoMenu.value = false;
    }

    /**

     * Navigate to previous/next photo in ordered list and show boundary toast at ends.

     */

    function switchPhoto(direction) {
      const next = selectedGlobalIndex.value + direction;
      if (next < 0) {
        showToastMessage("已经是第一张图片");
        return;
      }
      if (next >= orderedItems.value.length) {
        showToastMessage("已经是最后一张图片");
        return;
      }
      selectedGlobalIndex.value = next;
      selectedItem.value = orderedItems.value[next];
      setDraftFromItem(selectedItem.value);
      showLocationInfoMenu.value = false;
      resetPanZoom();
    }

    // Wheel controls zoom around current center.
    /**
     * Compute dynamic wheel zoom step based on current zoom range thresholds.
     */
    function getWheelZoomStep() {
      if (zoomPercent.value > 500) return 50;
      if (zoomPercent.value >= 200) return 20;
      return zoomStep.value;
    }

    // Wheel controls zoom around current center.
    /**
     * Apply wheel zoom with dynamic step, clamped to configured min/max zoom limits.
     */
    function onImageWheel(event) {
      event.preventDefault();
      const wheelStep = getWheelZoomStep();
      const delta = event.deltaY < 0 ? wheelStep : -wheelStep;
      zoomPercent.value = Math.min(maxZoom.value, Math.max(minZoom.value, zoomPercent.value + delta));
    }

    /**

     * Start image dragging and capture drag origin plus current pan baseline.

     */

    function startDrag(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging.active = true;
      dragging.startX = event.clientX;
      dragging.startY = event.clientY;
      dragging.baseX = pan.x;
      dragging.baseY = pan.y;
    }

    // Dragging updates pan offset in screen-space pixels.
    /**
     * Update pan offset during drag so image follows cursor movement in real time.
     */
    function onDrag(event) {
      if (!dragging.active) return;
      if ((event.buttons & 1) === 0) {
        endDrag();
        return;
      }
      pan.x = dragging.baseX + (event.clientX - dragging.startX);
      pan.y = dragging.baseY + (event.clientY - dragging.startY);
    }

    /**

     * End drag interaction and stop pan updates.

     */

    function endDrag() { dragging.active = false; }
    /**
     * Restore image transform to default viewing state.
     */
    function restoreImageState() { resetPanZoom(); }
    /**
     * Increase zoom by configured step while respecting maximum zoom boundary.
     */
    function zoomIn() { zoomPercent.value = Math.min(maxZoom.value, zoomPercent.value + zoomStep.value); }
    /**
     * Decrease zoom by configured step while respecting minimum zoom boundary.
     */
    function zoomOut() { zoomPercent.value = Math.max(minZoom.value, zoomPercent.value - zoomStep.value); }
    /**
     * Rotate current image clockwise by 90 degrees.
     */
    function rotateClockwise() { rotateDeg.value += 90; }
    /**
     * Rotate current image counterclockwise by 90 degrees.
     */
    function rotateCounterclockwise() { rotateDeg.value -= 90; }
    /**
     * Toggle horizontal mirror transform on the image.
     */
    function toggleMirror() { mirror.value = !mirror.value; }

    // Custom right-click menu for copy actions.
    /**
     * Open image context menu at pointer position for copy actions.
     */
    
    // ============================================================================
    // Context Menu, Overlay Panels, and Clipboard Actions
    // ============================================================================
    function openContextMenu(event) {
      event.preventDefault();
      contextPosition.x = event.clientX;
      contextPosition.y = event.clientY;
      showContextMenu.value = true;
    }

    /**

     * Close context/tooltip/popover style overlays that should not stay pinned.

     */

    function closeTransientPanels() {
      showContextMenu.value = false;
      showLocationInfoMenu.value = false;
    }

    /**

     * Toggle floating location detail popover in right-side customization panel.

     */

    function toggleLocationInfoMenu() {
      showLocationInfoMenu.value = !showLocationInfoMenu.value;
    }

    /**

     * Show or hide left metadata panel in viewer layout.

     */

    function toggleLeftPanel() { showLeftPanel.value = !showLeftPanel.value; }
    /**
     * Show or hide right customization panel in viewer layout.
     */
    function toggleRightPanel() { showRightPanel.value = !showRightPanel.value; }

    /**

     * Copy current image binary to clipboard through bridge API and show result toast.

     */

    async function contextCopyImage() {
      if (!selectedItem.value) return;
      const result = await API.copyImage(selectedItem.value.__absolutePath);
      if (result?.ok) showToastMessage("已成功复制到剪贴板");
      else showToastMessage(`复制失败：${result?.error || "未知错误"}`);
      closeTransientPanels();
    }

    /**

     * Copy current image absolute path to clipboard and show result toast.

     */

    async function contextCopyPath() {
      if (!selectedItem.value) return;
      const result = await API.copyPath(selectedItem.value.__absolutePath);
      if (result?.ok) showToastMessage("已成功复制图片路径");
      else showToastMessage(`复制失败：${result?.error || "未知错误"}`);
      closeTransientPanels();
    }

    /**

     * Copy current metadata JSON payload to clipboard and show result toast.

     */

    async function contextCopyJson() {
      if (!selectedItem.value) return;
      const result = await API.copyJson(selectedItem.value);
      if (result?.ok) showToastMessage("已成功复制图片元信息");
      else showToastMessage(`复制失败：${result?.error || "未知错误"}`);
      closeTransientPanels();
    }

    /**

     * Mark a specific field as dirty and display inline save confirmation controls.

     */

    
    // ============================================================================
    // Metadata Field Edit State and Persistence
    // ============================================================================
    function requestEdit(field) {
      editingDirty.value = true;
      if (field) activeEditField.value = field;
    }

    /**

     * Auto-resize single-line style textarea to fit wrapped content height.

     */

    function autoGrowFieldTextarea(element) {
      if (!element) return;
      const minHeight = 28;
      element.style.height = "auto";
      element.style.height = `${Math.max(minHeight, element.scrollHeight)}px`;
    }

    /**

     * Apply auto-grow behavior to all viewer field textareas after render updates.

     */

    function autoGrowAllFieldTextareas() {
      const nodes = document.querySelectorAll(".field-textarea");
      for (const node of nodes) autoGrowFieldTextarea(node);
    }

    /**

     * Handle textarea input by resizing the field and marking it dirty.

     */

    function onFieldTextareaInput(event, field) {
      autoGrowFieldTextarea(event.target);
      requestEdit(field);
    }
    /**
     * Discard unsaved edits by restoring draft values from current selected metadata item.
     */
    function cancelEdit() {
      saveNotice.visible = false;
      saveNotice.field = "";
      setDraftFromItem(selectedItem.value);
    }

    // Persist editable metadata fields into JSONL through IPC.
    /**
     * Persist current dirty field to metadata backend and synchronize local caches with response.
     */
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
          Description: editDraft.Description,
          HiddenDescription: editDraft.HiddenDescription,
        },
        location: {
          Site: editDraft.LocationSite,
        },
      };
      const result = await API.updateCustomization(payload);
      if (result.ok) {
        // Keep local caches in sync with server response.
        selectedItem.value = result.item;
        const inOrdered = orderedItems.value.findIndex((x) => x.FilePath === result.item.FilePath);
        if (inOrdered >= 0) orderedItems.value[inOrdered] = result.item;
        for (const group of galleryGroups.value) {
          const idx = group.items.findIndex((x) => x.FilePath === result.item.FilePath);
          if (idx >= 0) { group.items[idx] = result.item; break; }
        }
        setDraftFromItem(result.item, true);
        activeEditField.value = saveField;
        showSaveNotice("已修改", saveField);
      }
    }

    /**

     * Enter/exit image-only fullscreen mode via Fullscreen API.

     */

    
    // ============================================================================
    // Fullscreen, Window State, and Global Keyboard Shortcuts
    // ============================================================================
    async function toggleFullscreen() {
      const root = imageStageRef.value;
      if (!root) return;
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.requestFullscreen();
    }

    /**

     * Query main process for maximized state to keep custom window button icon in sync.

     */

    async function refreshWindowState() {
      if (typeof API.getWindowState !== "function") return;
      const state = await API.getWindowState();
      isWindowMaximized.value = Boolean(state?.isMaximized);
    }

    // Keyboard shortcuts available in viewer mode.
    /**
     * Handle global viewer shortcuts (navigation/fullscreen/confirm-save) with input-focus guards.
     */
    function onGlobalKeydown(event) {
      if (view.value !== "viewer") return;
      const active = document.activeElement;
      const isTypingTarget = Boolean(
        active &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || active.isContentEditable)
      );
      const isTextarea = Boolean(active && active.tagName === "TEXTAREA");
      const isTagInput = Boolean(active && active.classList && active.classList.contains("tag-input"));
      if (event.key === "Enter" && editingDirty.value && !event.isComposing && !isTextarea && !isTagInput) {
        event.preventDefault();
        confirmEdit();
        return;
      }
      if (isTypingTarget) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        switchPhoto(-1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        switchPhoto(1);
      }
      if (event.key === "Escape") closeTransientPanels();
    }

    /**

     * Forward custom titlebar actions (minimize/maximize/restore/close) to main process.

     */

    async function doWindowAction(action) { await API.windowAction(action); }

    /**

     * Toggle between maximize and restore based on current window state flag.

     */

    async function toggleWindowMaximizeRestore() {
      await doWindowAction(isWindowMaximized.value ? WINDOW_ACTIONS.restore : WINDOW_ACTIONS.maximize);
      await refreshWindowState();
    }

    // Dirty-check editable fields to show/hide confirm/cancel controls.
    watch(
      () => [
        editDraft.Title,
        editDraft.Rating,
        editDraft.Album,
        editDraft.LocationSite,
        editDraft.Tags.join("\u0001"),
        editDraft.Description,
        editDraft.HiddenDescription,
      ],
      () => {
        if (view.value !== "viewer") return;
        const compareTags = (selectedItem.value?.Customization?.Tags || []).join("\u0001");
        editingDirty.value =
          editDraft.Title !== (selectedItem.value?.Customization?.Title || "") ||
          Number(editDraft.Rating || 1) !== Number(selectedItem.value?.Customization?.Rating || 1) ||
          editDraft.Album !== (selectedItem.value?.Customization?.Album || "") ||
          editDraft.LocationSite !== (selectedItem.value?.Location?.Site || "") ||
          editDraft.Tags.join("\u0001") !== compareTags ||
          editDraft.Description !== (selectedItem.value?.Customization?.Description || "") ||
          editDraft.HiddenDescription !== (selectedItem.value?.Customization?.HiddenDescription || "");
      }
    );

    onMounted(async () => {
      // Initial render flow: config -> first gallery query -> global listeners.
      await loadConfig();
      await queryGallery(true);
      await refreshWindowState();
      await nextTick();
      autoGrowAllFieldTextareas();
      if (typeof API.onWindowStateChanged === "function") {
        removeWindowStateListener = API.onWindowStateChanged((state) => {
          isWindowMaximized.value = Boolean(state?.isMaximized);
        });
      }
      window.addEventListener("keydown", onGlobalKeydown);
      window.addEventListener("mousemove", onDrag);
      window.addEventListener("mouseup", endDrag);
      window.addEventListener("resize", onTooltipViewportChange);
      window.addEventListener("scroll", onTooltipViewportChange, true);
      document.addEventListener("mouseover", onTooltipMouseOver);
      document.addEventListener("mouseout", onTooltipMouseOut);
      document.addEventListener("mousedown", onTooltipGlobalHide);
      document.addEventListener("click", closeTransientPanels);
    });

    onBeforeUnmount(() => {
      // Cleanup global listeners when app unmounts.
      window.removeEventListener("keydown", onGlobalKeydown);
      window.removeEventListener("mousemove", onDrag);
      window.removeEventListener("mouseup", endDrag);
      window.removeEventListener("resize", onTooltipViewportChange);
      window.removeEventListener("scroll", onTooltipViewportChange, true);
      document.removeEventListener("mouseover", onTooltipMouseOver);
      document.removeEventListener("mouseout", onTooltipMouseOut);
      document.removeEventListener("mousedown", onTooltipGlobalHide);
      document.removeEventListener("click", closeTransientPanels);
      if (typeof removeWindowStateListener === "function") removeWindowStateListener();
      if (toastTimer) clearTimeout(toastTimer);
      if (saveNoticeTimer) clearTimeout(saveNoticeTimer);
      if (tooltipTimer) clearTimeout(tooltipTimer);
    });

    const exposed = {
      ICONS,
      WINDOW_ACTIONS,
      view,
      query,
      galleryGroups,
      total,
      hasMore,
      loading,
      filterOptions,
      isSelectionMode,
      batchStatus,
      selectedGalleryCount,
      batchHasChanges,
      canApplyBatchEdit,
      selectedItem,
      zoomPercent,
      rotateDeg,
      mirror,
      pan,
      showContextMenu,
      contextPosition,
      showPrivateNote,
      showLocationInfoMenu,
      showLeftPanel,
      showRightPanel,
      imageStageRef,
      isWindowMaximized,
      toast,
      saveNotice,
      dynamicTooltip,
      dynamicTooltipRef,
      editDraft,
      batchEdit,
      pendingTagInput,
      editingDirty,
      activeEditField,
      STAR_LEVELS,
      ratioStyle,
      viewerHeaderTime,
      windowToggleTip,
      windowToggleIcon,
      viewerImageStyle,
      minZoom,
      maxZoom,
      formatFileSize,
      buildImageUrl,
      enterSelectionMode,
      exitSelectionMode,
      onGalleryCardClick,
      isGallerySelected,
      toggleGallerySelection,
      clearGallerySelection,
      selectAllGalleryPhotos,
      addBatchTag,
      removeBatchTagAt,
      onBatchTagInputKeydown,
      clearBatchEditInputs,
      applyBatchEdit,
      loadMore,
      applySearch,
      applyFilterSort,
      resetAll,
      openViewer,
      closeViewer,
      switchPhoto,
      onImageWheel,
      startDrag,
      onDrag,
      endDrag,
      restoreImageState,
      zoomIn,
      zoomOut,
      rotateClockwise,
      rotateCounterclockwise,
      toggleMirror,
      openContextMenu,
      closeTransientPanels,
      toggleLeftPanel,
      toggleRightPanel,
      toggleLocationInfoMenu,
      contextCopyImage,
      contextCopyPath,
      contextCopyJson,
      onTagInputKeydown,
      addTag,
      removeTagAt,
      setRating,
      onFieldTextareaInput,
      requestEdit,
      cancelEdit,
      confirmEdit,
      toggleFullscreen,
      toggleWindowMaximizeRestore,
      doWindowAction,
    };
    provide("appContext", exposed);
    return exposed;
  },
};
</script>

