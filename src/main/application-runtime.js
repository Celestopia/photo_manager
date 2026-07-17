function createApplicationRuntime() {
  return {
    mainWindow: null,
    metadataIndex: new Map(),
    mediaPathIndex: new Map(),
    tagRegistryIndex: new Map(),
    albumRegistryIndex: new Map(),
    personRegistryIndex: new Map(),
    locationRegistryIndex: new Map(),
    activeLibrary: null,
    mediaToolsState: { available: false, error: "尚未检查媒体工具", versions: null },
    maintenanceState: { running: false, operation: "", progress: null, report: null },
    activeWorker: null,
    activeWorkerOperation: "",
    pendingAppClose: false,
    quickScanState: null,
  };
}

module.exports = { createApplicationRuntime };
