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

  // Tag registry
  listTags: () => ipcRenderer.invoke("tag:list"),
  createTag: (payload) => ipcRenderer.invoke("tag:create", toSerializable(payload)),
  updateTagDescription: (payload) => ipcRenderer.invoke("tag:update-description", toSerializable(payload)),
  deleteTagGlobally: (payload) => ipcRenderer.invoke("tag:delete-global", toSerializable(payload)),

  // Location registry
  listLocations: () => ipcRenderer.invoke("location:list"),
  createLocation: (payload) => ipcRenderer.invoke("location:create", toSerializable(payload)),
  updateLocation: (payload) => ipcRenderer.invoke("location:update", toSerializable(payload)),
  deleteLocationGlobally: (payload) => ipcRenderer.invoke("location:delete-global", toSerializable(payload)),

  // Album registry
  listAlbums: () => ipcRenderer.invoke("album:list"),
  createAlbum: (payload) => ipcRenderer.invoke("album:create", toSerializable(payload)),
  updateAlbumDescription: (payload) => ipcRenderer.invoke("album:update-description", toSerializable(payload)),
  deleteAlbumGlobally: (payload) => ipcRenderer.invoke("album:delete-global", toSerializable(payload)),

  // Person registry
  listPeople: () => ipcRenderer.invoke("person:list"),
  createPerson: (payload) => ipcRenderer.invoke("person:create", toSerializable(payload)),
  updatePersonDescription: (payload) => ipcRenderer.invoke("person:update-description", toSerializable(payload)),
  deletePersonGlobally: (payload) => ipcRenderer.invoke("person:delete-global", toSerializable(payload)),

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
