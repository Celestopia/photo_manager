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
    openingLibrary: false,
    maintenanceState: { running: false },
    activeWorker: null,
    activeWorkerOperation: "",
    pendingWindowClose: false,
    quickScanState: null,
  };
}

module.exports = { createApplicationRuntime };
