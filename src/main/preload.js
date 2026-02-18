/**
 * Preload bridge.
 *
 * Renderer cannot access Node/Electron directly (contextIsolation enabled).
 * We expose a minimal, explicit API surface through `window.photoManagerApi`.
 */
const { contextBridge, ipcRenderer } = require("electron");

// Defensive conversion to plain JSON to avoid structured clone edge cases.
/**
 * Convert any payload to plain JSON-compatible data.
 * Prevents IPC failures caused by non-cloneable reactive/proxy objects.
 */
function toSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

contextBridge.exposeInMainWorld("photoManagerApi", {
  // App/runtime config
  getConfig: () => ipcRenderer.invoke("app:get-config"),

  // Gallery data query
  queryGallery: (query) => ipcRenderer.invoke("gallery:query", toSerializable(query)),

  // Metadata mutation
  updateCustomization: (payload) => ipcRenderer.invoke("photo:update-customization", toSerializable(payload)),
  batchUpdateMetadata: (payload) => ipcRenderer.invoke("photo:batch-update", toSerializable(payload)),

  // Clipboard helpers
  copyPath: (absolutePath) => ipcRenderer.invoke("photo:copy-path", absolutePath),
  copyJson: (item) => ipcRenderer.invoke("photo:copy-json", toSerializable(item)),
  copyImage: (absolutePath) => ipcRenderer.invoke("photo:copy-image", absolutePath),

  // Custom title-bar controls
  windowAction: (action) => ipcRenderer.invoke("window:action", action),
  getWindowState: () => ipcRenderer.invoke("window:get-state"),
  onWindowStateChanged: (listener) => {
    if (typeof listener !== "function") return () => {};
    const wrapped = (_, state) => listener(toSerializable(state || {}));
    ipcRenderer.on("window:state-changed", wrapped);
    return () => ipcRenderer.removeListener("window:state-changed", wrapped);
  },
});
