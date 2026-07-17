import { computed, reactive, ref } from "vue";

/**
 * Owns the single active-library session, entry workflow, maintenance dialogs,
 * and all library-lifecycle IPC subscriptions.
 */
export function useLibrarySession({
  api,
  showToastMessage,
  hasUnsavedChanges,
  onLibraryOpened,
  onLibraryClosed,
  onMaintenanceRefresh,
}) {
  const view = ref("library-entry");
  const libraryState = ref({
    state: "closed",
    active: null,
    lastLibraryPath: "",
    lastLibraryName: "",
    mediaTools: { available: false, error: "" },
    maintenance: { running: false },
  });
  const entry = reactive({
    busy: false,
    cancellable: false,
    operation: "",
    progress: {},
    error: "",
    libraryName: "",
    libraryPath: "",
    canOpenLibrary: false,
  });
  const initializationConfirm = reactive({ visible: false, path: "", name: "", mediaCount: 0, acknowledged: false });
  const gallerySettingsOpen = ref(false);
  const libraryInfo = reactive({ visible: false, name: "" });
  const maintenanceDialog = reactive({
    visible: false,
    operation: "",
    running: false,
    completed: false,
    reprobe: false,
    force: false,
    progress: {},
    result: null,
    error: "",
    reportText: "",
  });

  const maintenanceDialogTitle = computed(() => ({
    update: "更新元数据",
    verify: "检查元数据",
    thumbnails: "生成缩略图",
    export: "导出元数据 CSV",
  }[maintenanceDialog.operation] || "图库维护"));
  const maintenanceDialogDescription = computed(() => ({
    update: "重新扫描当前图库中的受支持媒体，识别新增、删除、移动或内容发生变化的文件，并更新元数据。",
    verify: "以只读方式核对图库文件与现有元数据是否匹配。此操作只生成检查报告，不修改媒体文件、注册表或元数据。",
    thumbnails: "检查当前图库的缩略图缓存，并为缺失或过期的图片、视频封面重新生成缩略图。",
    export: "将当前图库的文件信息、元数据和个性化信息导出为 CSV 文件。",
  }[maintenanceDialog.operation] || ""));

  let removeLibraryStateListener = null;
  let removeLibraryProgressListener = null;
  let removeMaintenanceProgressListener = null;
  let removeMaintenanceCompletedListener = null;

  function setEntryError(message) {
    entry.error = String(message || "未知错误");
    entry.busy = false;
    entry.cancellable = false;
  }

  function applyLibraryState(state) {
    libraryState.value = state || libraryState.value;
    if (state?.active) {
      entry.libraryName = state.active.name || "";
      entry.libraryPath = state.active.root || "";
    }
  }

  async function enterOpenedLibrary(state) {
    applyLibraryState(state);
    await onLibraryOpened?.(state);
    view.value = "gallery";
    entry.busy = false;
    entry.cancellable = false;
    entry.error = "";
    entry.canOpenLibrary = false;
  }

  async function openLibraryPath(libraryPath, options = {}) {
    entry.busy = true;
    entry.cancellable = false;
    entry.operation = "open";
    entry.error = "";
    entry.libraryPath = libraryPath;
    const result = await api.openLibrary({ path: libraryPath, force: Boolean(options.force) });
    if (!result?.ok && result?.code === "LIBRARY_LOCKED" && result?.lockState?.forceAllowed && !options.force) {
      const lock = result.lockState.lock || {};
      const confirmed = window.confirm(`图库存在可能已经失效的锁。\n\n主机：${lock.HostName || "未知"}\n进程：${lock.ProcessId || "未知"}\n启动时间：${lock.ApplicationStartedAt || "未知"}\n\n强制解锁可能导致并发写入和数据损坏。确认继续吗？`);
      if (confirmed) return openLibraryPath(libraryPath, { force: true });
    }
    if (!result?.ok) {
      entry.canOpenLibrary = true;
      setEntryError(result?.error || "无法打开图库");
      return false;
    }
    await enterOpenedLibrary(result.library);
    return true;
  }

  async function enterLibraryFromEntry() {
    const libraryPath = entry.libraryPath || libraryState.value.lastLibraryPath;
    if (libraryPath) await openLibraryPath(libraryPath);
  }

  async function chooseLibrary() {
    entry.error = "";
    const selection = await api.chooseLibraryDirectory();
    if (!selection?.ok) return;
    entry.libraryPath = selection.path;
    entry.libraryName = selection.path.split(/[\\/]/).filter(Boolean).pop() || selection.path;
    entry.busy = true;
    entry.cancellable = true;
    entry.operation = "quick-scan";
    entry.progress = { phase: "quick-scan", processed: 0 };
    const inspected = await api.inspectLibrary(selection.path);
    entry.busy = false;
    entry.cancellable = false;
    if (!inspected?.ok) {
      if (inspected?.code === "OPERATION_CANCELLED") {
        entry.error = "";
        entry.operation = "";
        return;
      }
      setEntryError(inspected?.error || "无法检查所选目录");
      return;
    }
    const inspection = inspected.inspection;
    if (inspection.kind === "existing") {
      entry.libraryName = inspection.manifest?.name || entry.libraryName;
      await openLibraryPath(inspection.root);
      return;
    }
    if (inspection.kind === "failed-initialization") {
      const clean = window.confirm(`该目录包含一次失败的图库初始化：\n\n${inspection.marker?.Error || "未知错误"}\n\n失败日志会保留到你确认重试为止。是否删除本次失败的管理数据，并立即重新扫描该目录以重试初始化？`);
      if (clean) {
        const cleaned = await api.cleanupFailedInitialization(inspection.root);
        if (!cleaned?.ok) {
          setEntryError(cleaned?.error || "清理失败");
          return;
        }
        entry.busy = true;
        entry.cancellable = true;
        entry.operation = "quick-scan";
        entry.progress = { phase: "quick-scan", processed: 0 };
        const rescanned = await api.inspectLibrary(inspection.root);
        entry.busy = false;
        entry.cancellable = false;
        if (!rescanned?.ok || rescanned.inspection?.kind !== "uninitialized") {
          setEntryError(rescanned?.error || "无法重新扫描图库目录");
          return;
        }
        Object.assign(initializationConfirm, {
          visible: true,
          path: rescanned.inspection.root,
          name: rescanned.inspection.name,
          mediaCount: rescanned.inspection.mediaCount || 0,
          acknowledged: false,
        });
      }
      return;
    }
    Object.assign(initializationConfirm, {
      visible: true,
      path: inspection.root,
      name: inspection.name,
      mediaCount: inspection.mediaCount || 0,
      acknowledged: false,
    });
  }

  function closeInitializationConfirm() {
    initializationConfirm.visible = false;
    initializationConfirm.acknowledged = false;
  }

  async function confirmInitializeLibrary() {
    const payload = { path: initializationConfirm.path, name: initializationConfirm.name };
    closeInitializationConfirm();
    entry.busy = true;
    entry.cancellable = true;
    entry.operation = "initialize";
    entry.error = "";
    entry.progress = { phase: "validate", processed: 0 };
    const result = await api.initializeLibrary(payload);
    if (!result?.ok) {
      if (result?.code === "OPERATION_CANCELLED") {
        entry.busy = false;
        entry.cancellable = false;
        entry.operation = "";
        entry.error = "";
        return;
      }
      entry.canOpenLibrary = false;
      setEntryError(result?.error || "图库初始化失败");
      return;
    }
    await enterOpenedLibrary(result.library);
  }

  async function cancelLibraryOperation() {
    const confirmed = window.confirm("确定取消当前操作吗？初始化取消后，本轮创建的全部未完成管理数据都会被删除。");
    if (!confirmed) return;
    if (entry.operation === "quick-scan") await api.cancelLibraryScan();
    if (entry.operation === "initialize") await api.cancelLibraryInitialization();
  }

  async function recheckMediaTools() {
    entry.busy = true;
    const state = await api.recheckMediaTools();
    libraryState.value = { ...libraryState.value, mediaTools: state };
    entry.busy = false;
    entry.error = state.available ? "" : state.error;
  }

  function toggleGallerySettings() {
    gallerySettingsOpen.value = !gallerySettingsOpen.value;
  }

  function closeGallerySettings() {
    gallerySettingsOpen.value = false;
  }

  function openLibraryInfo() {
    gallerySettingsOpen.value = false;
    libraryInfo.name = libraryState.value.active?.name || "";
    libraryInfo.visible = true;
  }

  function closeLibraryInfo() { libraryInfo.visible = false; }

  async function saveLibraryInfo() {
    const result = await api.updateLibraryInfo({ name: libraryInfo.name });
    if (!result?.ok) {
      showToastMessage(`保存失败：${result?.error || "未知错误"}`);
      return;
    }
    libraryState.value = { ...libraryState.value, active: result.library };
    libraryInfo.visible = false;
    showToastMessage("图库名称已更新");
  }

  async function openLibraryRoot() { await api.openLibraryRoot(); }
  async function openLibraryManagerDir() { await api.openLibraryManagerDir(); }
  async function openLibraryLogDir() { await api.openLibraryLogDir(); }

  function openMaintenanceDialog(operation) {
    gallerySettingsOpen.value = false;
    Object.assign(maintenanceDialog, {
      visible: true,
      operation,
      running: false,
      completed: false,
      reprobe: false,
      force: false,
      progress: {},
      result: null,
      error: "",
      reportText: "",
    });
  }

  function closeMaintenanceDialog() {
    if (!maintenanceDialog.running) maintenanceDialog.visible = false;
  }

  async function startMaintenanceOperation(overwrite = false) {
    maintenanceDialog.running = true;
    maintenanceDialog.completed = false;
    maintenanceDialog.progress = { phase: "starting", message: "正在启动任务" };
    const result = await api.startMaintenance({
      operation: maintenanceDialog.operation,
      reprobe: maintenanceDialog.reprobe,
      force: maintenanceDialog.force,
      overwrite,
    });
    if (!result?.ok && result?.code === "OUTPUT_EXISTS" && !overwrite) {
      maintenanceDialog.running = false;
      if (window.confirm("photo_metadata.csv 已存在。是否覆盖现有文件？")) await startMaintenanceOperation(true);
      return;
    }
    maintenanceDialog.running = false;
    maintenanceDialog.completed = true;
    maintenanceDialog.result = result?.result || null;
    maintenanceDialog.error = result?.ok ? "" : result?.error || "任务失败";
    maintenanceDialog.reportText = JSON.stringify(result?.ok ? result.result : { error: maintenanceDialog.error }, null, 2);
    if (result?.ok) await onMaintenanceRefresh?.(maintenanceDialog.operation);
  }

  async function copyMaintenanceReport() {
    await api.copyText(maintenanceDialog.reportText || "");
    showToastMessage("维护报告已复制");
  }

  async function showMaintenanceOutput() {
    const result = await api.showMaintenanceOutput();
    if (!result?.ok) showToastMessage(`无法定位 CSV：${result?.error || "未知错误"}`);
  }

  async function returnToLibraryEntry() {
    gallerySettingsOpen.value = false;
    if (hasUnsavedChanges?.()) {
      showToastMessage("请先保存或放弃当前修改");
      return;
    }
    if (!window.confirm("确定退出当前图库吗？图库会被安全关闭并释放占用锁，随后返回图库入口；原始媒体和 .photo_manager 中的数据不会被删除。")) return;
    const result = await api.closeLibrary();
    if (!result?.ok) {
      showToastMessage(`无法关闭图库：${result?.error || "未知错误"}`);
      return;
    }
    await onLibraryClosed?.(result.library);
    applyLibraryState(result.library);
    view.value = "library-entry";
    entry.busy = false;
    entry.error = "";
    entry.canOpenLibrary = Boolean(entry.libraryPath || result.library?.lastLibraryPath);
  }

  async function initialize() {
    if (typeof api.onLibraryStateChanged === "function") {
      removeLibraryStateListener = api.onLibraryStateChanged(applyLibraryState);
    }
    if (typeof api.onLibraryProgress === "function") {
      removeLibraryProgressListener = api.onLibraryProgress((progress) => {
        entry.progress = progress || {};
      });
    }
    if (typeof api.onMaintenanceProgress === "function") {
      removeMaintenanceProgressListener = api.onMaintenanceProgress((progress) => {
        maintenanceDialog.progress = progress || {};
        if (progress?.level && progress?.message) {
          const previous = maintenanceDialog.reportText ? `${maintenanceDialog.reportText}\n` : "";
          maintenanceDialog.reportText = `${previous}[${progress.level}] ${progress.message}`;
        }
      });
    }
    if (typeof api.onMaintenanceCompleted === "function") {
      removeMaintenanceCompletedListener = api.onMaintenanceCompleted(() => {});
    }

    const initialState = await api.getLibraryState();
    applyLibraryState(initialState);
    if (initialState?.active) {
      await enterOpenedLibrary(initialState);
    } else if (initialState?.lastLibraryPath) {
      entry.libraryPath = initialState.lastLibraryPath;
      entry.libraryName = initialState.lastLibraryName
        || initialState.lastLibraryPath.split(/[\\/]/).filter(Boolean).pop()
        || initialState.lastLibraryPath;
      entry.canOpenLibrary = true;
    }
  }

  function dispose() {
    for (const removeListener of [
      removeLibraryStateListener,
      removeLibraryProgressListener,
      removeMaintenanceProgressListener,
      removeMaintenanceCompletedListener,
    ]) {
      if (typeof removeListener === "function") removeListener();
    }
  }

  return {
    view,
    libraryState,
    entry,
    initializationConfirm,
    gallerySettingsOpen,
    libraryInfo,
    maintenanceDialog,
    maintenanceDialogTitle,
    maintenanceDialogDescription,
    applyLibraryState,
    openLibraryPath,
    enterLibraryFromEntry,
    chooseLibrary,
    closeInitializationConfirm,
    confirmInitializeLibrary,
    cancelLibraryOperation,
    recheckMediaTools,
    toggleGallerySettings,
    closeGallerySettings,
    openLibraryInfo,
    closeLibraryInfo,
    saveLibraryInfo,
    openLibraryRoot,
    openLibraryManagerDir,
    openLibraryLogDir,
    openMaintenanceDialog,
    closeMaintenanceDialog,
    startMaintenanceOperation,
    copyMaintenanceReport,
    showMaintenanceOutput,
    returnToLibraryEntry,
    initialize,
    dispose,
  };
}
