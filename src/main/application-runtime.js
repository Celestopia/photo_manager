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
    mediaToolsState: { available: false, error: "Media tools have not been checked", versions: null },
    maintenanceState: { running: false },
    activeWorker: null,
    activeWorkerOperation: "",
    pendingAppClose: false,
    quickScanState: null,
  };
}

module.exports = { createApplicationRuntime };
