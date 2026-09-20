import { computed, reactive, ref } from "vue";

/**
 * Owns this window's active-library session, entry workflow, maintenance dialogs,
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
    update: "Update Metadata",
    verify: "Verify Metadata",
    thumbnails: "Generate Thumbnails",
    "video-covers": "Generate Video Covers",
    "semantic-index": "Build Semantic Index",
    export: "Export Metadata CSV",
  }[maintenanceDialog.operation] || "Library Maintenance"));
  const maintenanceDialogDescription = computed(() => ({
    update: "Rescan supported media in the current library, detect added, removed, moved, or changed files, and update metadata.",
    verify: "Compare the current library files with existing metadata in read-only mode. This produces a report without changing media, registries, or metadata.",
    thumbnails: "Check the current library's thumbnail cache and regenerate missing or stale image and video thumbnails.",
    "video-covers": "Generate first-frame covers for all indexed videos in this library. Existing valid covers are reused; duplicate videos share one cover.",
    "semantic-index": "Build missing or changed local embeddings for the whole library. Completed work is reusable after cancellation. Searches never update the index automatically.",
    export: "Export file information, metadata, and customizations from the current library to a CSV file.",
  }[maintenanceDialog.operation] || ""));

  let entryGeneration = 0;
  let maintenanceGeneration = 0;

  let removeLibraryStateListener = null;
  let removeLibraryProgressListener = null;
  let removeMaintenanceProgressListener = null;

  function setEntryError(message) {
    entry.error = String(message || "Unknown error");
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
    const generation = entryGeneration;
    applyLibraryState(state);
    await onLibraryOpened?.(state);
    if (generation !== entryGeneration) return;
    view.value = "gallery";
    entry.busy = false;
    entry.cancellable = false;
    entry.error = "";
    entry.canOpenLibrary = false;
  }

  async function openLibraryPath(libraryPath, options = {}) {
    const request = ++entryGeneration;
    try {
      entry.busy = true;
      entry.cancellable = false;
      entry.operation = "open";
      entry.error = "";
      entry.libraryPath = libraryPath;
      const result = await api.openLibrary({ path: libraryPath, force: Boolean(options.force) });
      if (request !== entryGeneration) return;
      if (!result?.ok && result?.code === "LIBRARY_LOCKED" && result?.lockState?.forceAllowed && !options.force) {
        const lock = result.lockState.lock || {};
        const confirmed = window.confirm(`The library may have a stale lock.\n\nHost: ${lock.HostName || "Unknown"}\nProcess: ${lock.ProcessId || "Unknown"}\nStarted: ${lock.ApplicationStartedAt || "Unknown"}\n\nForcing an unlock may allow concurrent writes and corrupt data. Continue?`);
        if (confirmed) return await openLibraryPath(libraryPath, { force: true });
      }
      if (!result?.ok) {
        entry.canOpenLibrary = true;
        setEntryError(result?.error || "Could not open library");
        return false;
      }
      await enterOpenedLibrary(result.library);
      return true;
    } catch (error) {
      if (request === entryGeneration) setEntryError(error?.message || "Library operation failed");
      return false;
    } finally {
      if (request === entryGeneration) { entry.busy = false; entry.cancellable = false; }
    }
  }

  async function enterLibraryFromEntry() {
    const libraryPath = entry.libraryPath || libraryState.value.lastLibraryPath;
    if (libraryPath) await openLibraryPath(libraryPath);
  }

  async function chooseLibrary() {
    const request = ++entryGeneration;
    try {
      entry.error = "";
      entry.busy = true;
      const selection = await api.chooseLibraryDirectory();
      if (request !== entryGeneration) return;
      if (!selection?.ok) return;
      entry.libraryPath = selection.path;
      entry.libraryName = selection.path.split(/[\\/]/).filter(Boolean).pop() || selection.path;
      entry.busy = true;
      entry.cancellable = true;
      entry.operation = "quick-scan";
      entry.progress = { phase: "quick-scan", processed: 0 };
      const inspected = await api.inspectLibrary(selection.path);
      if (request !== entryGeneration) return;
      entry.busy = false;
      entry.cancellable = false;
      if (!inspected?.ok) {
        if (inspected?.code === "OPERATION_CANCELLED") {
          entry.error = "";
          entry.operation = "";
          return;
        }
        setEntryError(inspected?.error || "Could not inspect the selected folder");
        return;
      }
      const inspection = inspected.inspection;
      if (inspection.kind === "existing") {
        entry.libraryName = inspection.manifest?.name || entry.libraryName;
        await openLibraryPath(inspection.root);
        return;
      }
      if (inspection.kind === "failed-initialization") {
        const clean = window.confirm(`This folder contains data from a failed library initialization:\n\n${inspection.marker?.Error || "Unknown error"}\n\nThe failure log will remain until you confirm a retry. Delete the incomplete management data and rescan the folder now?`);
        if (clean) {
          const cleaned = await api.cleanupFailedInitialization(inspection.root);
          if (request !== entryGeneration) return;
      if (request !== entryGeneration) return;
          if (!cleaned?.ok) {
            setEntryError(cleaned?.error || "Could not clean up incomplete data");
            return;
          }
          entry.busy = true;
          entry.cancellable = true;
          entry.operation = "quick-scan";
          entry.progress = { phase: "quick-scan", processed: 0 };
          const rescanned = await api.inspectLibrary(inspection.root);
          if (request !== entryGeneration) return;
      if (request !== entryGeneration) return;
          entry.busy = false;
          entry.cancellable = false;
          if (!rescanned?.ok || rescanned.inspection?.kind !== "uninitialized") {
            setEntryError(rescanned?.error || "Could not rescan the library folder");
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
    } catch (error) {
      if (request === entryGeneration) setEntryError(error?.message || "Library operation failed");
      return false;
    } finally {
      if (request === entryGeneration) { entry.busy = false; entry.cancellable = false; }
    }
  }

  function closeInitializationConfirm() {
    initializationConfirm.visible = false;
    initializationConfirm.acknowledged = false;
  }

  async function confirmInitializeLibrary() {
    const request = ++entryGeneration;
    try {
      const payload = { path: initializationConfirm.path, name: initializationConfirm.name };
      closeInitializationConfirm();
      entry.busy = true;
      entry.cancellable = true;
      entry.operation = "initialize";
      entry.error = "";
      entry.progress = { phase: "validate", processed: 0 };
      const result = await api.initializeLibrary(payload);
      if (request !== entryGeneration) return;
      if (!result?.ok) {
        if (result?.code === "OPERATION_CANCELLED") {
          entry.busy = false;
          entry.cancellable = false;
          entry.operation = "";
          entry.error = "";
          return;
        }
        entry.canOpenLibrary = false;
        setEntryError(result?.error || "Library initialization failed");
        return;
      }
      await enterOpenedLibrary(result.library);
    } catch (error) {
      if (request === entryGeneration) setEntryError(error?.message || "Library operation failed");
      return false;
    } finally {
      if (request === entryGeneration) { entry.busy = false; entry.cancellable = false; }
    }
  }

  async function cancelLibraryOperation() {
    const confirmed = window.confirm("Cancel the current operation? Any incomplete management data created during this initialization will be deleted.");
    if (!confirmed) return;
    if (entry.operation === "quick-scan") await api.cancelLibraryScan();
    if (entry.operation === "initialize") await api.cancelLibraryInitialization();
  }

  async function recheckMediaTools() {
    const request = ++entryGeneration;
    try {
      entry.busy = true;
      const state = await api.recheckMediaTools();
      if (request !== entryGeneration) return;
      libraryState.value = { ...libraryState.value, mediaTools: state };
      entry.busy = false;
      entry.error = state.available ? "" : state.error;
    } catch (error) {
      if (request === entryGeneration) setEntryError(error?.message || "Library operation failed");
      return false;
    } finally {
      if (request === entryGeneration) { entry.busy = false; entry.cancellable = false; }
    }
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
      showToastMessage(`Could not save: ${result?.error || "Unknown error"}`);
      return;
    }
    libraryState.value = { ...libraryState.value, active: result.library };
    libraryInfo.visible = false;
    showToastMessage("Library name updated");
  }

  async function openLibraryRoot() { await api.openLibraryRoot(); }
  async function openLibraryManagerDir() { await api.openLibraryManagerDir(); }
  async function openLibraryLogDir() { await api.openLibraryLogDir(); }

  function openMaintenanceDialog(operation) {
    if (maintenanceDialog.running) return;
    maintenanceGeneration++;
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
    if (maintenanceDialog.running) return;
    const request = ++maintenanceGeneration;
    const operation = maintenanceDialog.operation;
    maintenanceDialog.running = true;
    maintenanceDialog.completed = false;
    maintenanceDialog.error = "";
    maintenanceDialog.progress = { phase: "starting", message: "Starting task" };
    try {
      const result = await api.startMaintenance({
        operation, reprobe: maintenanceDialog.reprobe, force: maintenanceDialog.force, overwrite,
      });
      if (request !== maintenanceGeneration) return;
      if (!result?.ok && result?.code === "OUTPUT_EXISTS" && !overwrite) {
        maintenanceDialog.running = false;
        if (window.confirm("photo_metadata.csv already exists. Replace it?")) await startMaintenanceOperation(true);
        return;
      }
      maintenanceDialog.completed = true;
      maintenanceDialog.result = result?.result || null;
      maintenanceDialog.error = result?.ok ? "" : result?.error || "Task failed";
      maintenanceDialog.reportText = JSON.stringify(result?.ok ? result.result : { error: maintenanceDialog.error }, null, 2);
      // Resource URLs may be revoked even when a cache-changing worker fails.
      await onMaintenanceRefresh?.(operation, Boolean(result?.ok));
    } catch (error) {
      if (request === maintenanceGeneration) {
        maintenanceDialog.completed = true;
        maintenanceDialog.error = error?.message || "Task failed";
        maintenanceDialog.reportText = JSON.stringify({ error: maintenanceDialog.error }, null, 2);
      }
    } finally {
      if (request === maintenanceGeneration) maintenanceDialog.running = false;
    }
  }

  async function copyMaintenanceReport() {
    await api.copyText(maintenanceDialog.reportText || "");
    showToastMessage("Maintenance report copied");
  }

  async function showMaintenanceOutput() {
    const result = await api.showMaintenanceOutput();
    if (!result?.ok) showToastMessage(`Could not locate CSV: ${result?.error || "Unknown error"}`);
  }

  async function returnToLibraryEntry() {
    gallerySettingsOpen.value = false;
    if (hasUnsavedChanges?.()) {
      showToastMessage("Save or discard the current changes first");
      return;
    }
    if (!window.confirm("Close the current library? The library will close safely, release its lock, and return to the library entry screen. Original media and data under .photo_manager will not be deleted.")) return;
    const result = await api.closeLibrary();
    if (!result?.ok) {
      showToastMessage(`Could not close library: ${result?.error || "Unknown error"}`);
      return;
    }
    entryGeneration++;
    maintenanceGeneration++;
    maintenanceDialog.running = false;
    maintenanceDialog.visible = false;
    await onLibraryClosed?.(result.library);
    applyLibraryState(result.library);
    view.value = "library-entry";
    entry.busy = false;
    entry.error = "";
    entry.canOpenLibrary = Boolean(entry.libraryPath || result.library?.lastLibraryPath);
  }

  async function initialize() {
    const request = ++entryGeneration;
    try {
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
      const initialState = await api.getLibraryState();
      if (request !== entryGeneration) return;
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
    } catch (error) {
      if (request === entryGeneration) setEntryError(error?.message || "Library operation failed");
      return false;
    } finally {
      if (request === entryGeneration) { entry.busy = false; entry.cancellable = false; }
    }
  }

  function dispose() {
    entryGeneration++;
    maintenanceGeneration++;
    entry.busy = false;
    entry.cancellable = false;
    maintenanceDialog.running = false;
    for (const removeListener of [
      removeLibraryStateListener,
      removeLibraryProgressListener,
      removeMaintenanceProgressListener,
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
