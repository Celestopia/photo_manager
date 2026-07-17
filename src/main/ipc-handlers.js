const { clipboard, dialog, ipcMain, nativeImage, shell } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

function registerIpcHandlers(options) {
  const {
    runtime,
    configPath,
    normalizeMediaConfig,
    applyConfigPatch,
    persistConfig,
    toSerializable,
    appendLog,
    getLibraryState,
    checkMediaTools,
    inspectLibraryDirectory,
    openLibrary,
    resolveLibraryPaths,
    runOperationWorker,
    inspectLibraryLock,
    closeLibrary,
    requireOpenLibrary,
    prepareLibraryWrite,
    normalizeLibraryName,
    writeLibraryManifest,
    emitLibraryState,
    runMaintenanceOperation,
    queryGallery,
    resolveIndexedMediaPath,
    services,
  } = options;
  const { albumService, locationService, metadataEditService, personService, tagService } = services;

  ipcMain.handle("app:get-config", async () => toSerializable(runtime.config));
  ipcMain.handle("app:update-config", async (_, patch) => {
    try {
      runtime.config = applyConfigPatch(runtime.config, patch, normalizeMediaConfig);
      await persistConfig(configPath, runtime.config);
      return { ok: true, config: toSerializable(runtime.config) };
    } catch (error) {
      appendLog(`Failed to update config: ${error.message}`);
      return { ok: false, error: "Failed to update config" };
    }
  });

  ipcMain.handle("library:get-state", async () => toSerializable(getLibraryState()));
  ipcMain.handle("library:recheck-media-tools", async () => toSerializable(await checkMediaTools()));
  ipcMain.handle("library:choose-directory", async () => {
    const result = await dialog.showOpenDialog(runtime.mainWindow, {
      title: "选择图库根目录",
      properties: ["openDirectory"],
    });
    return result.canceled || !result.filePaths[0] ? { ok: false, canceled: true } : { ok: true, path: result.filePaths[0] };
  });
  ipcMain.handle("library:inspect", async (_, rawRoot) => {
    try {
      return { ok: true, inspection: await inspectLibraryDirectory(rawRoot) };
    } catch (error) {
      return { ok: false, error: error.message, code: error.code };
    }
  });
  ipcMain.handle("library:cancel-scan", async () => {
    if (runtime.quickScanState) runtime.quickScanState.cancelled = true;
    return { ok: true };
  });
  ipcMain.handle("library:open", async (_, payload) => {
    try {
      return { ok: true, library: await openLibrary(payload?.path, { force: Boolean(payload?.force) }) };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        code: error.code,
        lockState: error.lockState ? toSerializable(error.lockState) : null,
        initialization: error.initialization || null,
      };
    }
  });
  ipcMain.handle("library:initialize", async (_, payload) => {
    if (runtime.activeLibrary) return { ok: false, error: "Close the active library before initializing another one" };
    try {
      const paths = resolveLibraryPaths(payload?.path);
      const result = await runOperationWorker("initialize", paths.root, { name: payload?.name || path.basename(paths.root) });
      const library = await openLibrary(paths.root);
      return { ok: true, result, library };
    } catch (error) {
      return { ok: false, error: error.message, code: error.code };
    }
  });
  ipcMain.handle("library:cancel-initialization", async () => {
    if (!runtime.activeWorker) return { ok: false, error: "No initialization is running" };
    runtime.activeWorker.send({ type: "cancel" });
    return { ok: true };
  });
  ipcMain.handle("library:cleanup-failed-initialization", async (_, rawRoot) => {
    try {
      const paths = resolveLibraryPaths(rawRoot);
      const marker = JSON.parse(await fsp.readFile(paths.initializationFile, "utf8"));
      if (!["failed", "initializing"].includes(marker?.Status)) throw new Error("No incomplete initialization marker was found");
      const lockState = await inspectLibraryLock(paths);
      if (lockState.active) throw new Error("The library initialization process is still active");
      await fsp.rm(paths.managerDir, { recursive: true, force: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle("library:close", async () => {
    try {
      return { ok: true, library: await closeLibrary() };
    } catch (error) {
      return { ok: false, error: error.message, code: error.code };
    }
  });
  ipcMain.handle("library:update-info", async (_, payload) => {
    try {
      const library = requireOpenLibrary({ writable: true });
      await prepareLibraryWrite("library-name-update", { immediate: true });
      const nextManifest = {
        ...library.manifest,
        name: normalizeLibraryName(payload?.name),
        updatedAt: new Date().toISOString(),
      };
      library.manifest = await writeLibraryManifest(library.paths, nextManifest);
      emitLibraryState();
      return { ok: true, library: getLibraryState().active };
    } catch (error) {
      return { ok: false, error: error.message, code: error.code };
    }
  });
  ipcMain.handle("library:open-root", async () => {
    try {
      const library = requireOpenLibrary();
      const error = await shell.openPath(library.paths.root);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle("library:open-manager-dir", async () => {
    try {
      const library = requireOpenLibrary();
      const error = await shell.openPath(library.paths.managerDir);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle("library:open-log-dir", async () => {
    try {
      const library = requireOpenLibrary();
      const error = await shell.openPath(library.paths.logDir);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("maintenance:show-output", async () => {
    try {
      const library = requireOpenLibrary();
      const outputFile = path.join(library.paths.dataDir, "photo_metadata.csv");
      if (!fs.existsSync(outputFile)) return { ok: false, error: "导出的 CSV 文件不存在" };
      shell.showItemInFolder(outputFile);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle("maintenance:get-state", async () => toSerializable(runtime.maintenanceState));
  ipcMain.handle("maintenance:start", async (_, payload) => {
    const operation = String(payload?.operation || "");
    if (!["update", "verify", "thumbnails", "export"].includes(operation)) return { ok: false, error: "Unknown maintenance operation" };
    const outputFile = runtime.activeLibrary?.paths ? path.join(runtime.activeLibrary.paths.dataDir, "photo_metadata.csv") : "";
    if (operation === "export" && fs.existsSync(outputFile) && !payload?.overwrite) {
      return { ok: false, code: "OUTPUT_EXISTS", error: "photo_metadata.csv already exists" };
    }
    return runMaintenanceOperation(operation, { reprobe: Boolean(payload?.reprobe), force: Boolean(payload?.force) });
  });

  ipcMain.handle("gallery:query", async (_, query) => toSerializable(queryGallery(query)));

  ipcMain.handle("tag:list", async () => toSerializable(await tagService.list()));
  ipcMain.handle("tag:create", async (_, payload) => toSerializable(await tagService.create(payload)));
  ipcMain.handle("tag:update", async (_, payload) => toSerializable(await tagService.update(payload)));
  ipcMain.handle("tag:delete-global", async (_, payload) => toSerializable(await tagService.deleteGlobal(payload)));
  ipcMain.handle("person:list", async () => toSerializable(await personService.list()));
  ipcMain.handle("person:create", async (_, payload) => toSerializable(await personService.create(payload)));
  ipcMain.handle("person:update", async (_, payload) => toSerializable(await personService.update(payload)));
  ipcMain.handle("person:delete-global", async (_, payload) => toSerializable(await personService.deleteGlobal(payload)));
  ipcMain.handle("location:list", async () => toSerializable(await locationService.list()));
  ipcMain.handle("location:create", async (_, payload) => toSerializable(await locationService.create(payload)));
  ipcMain.handle("location:update", async (_, payload) => toSerializable(await locationService.update(payload)));
  ipcMain.handle("location:delete-global", async (_, payload) => toSerializable(await locationService.deleteGlobal(payload)));
  ipcMain.handle("album:list", async () => toSerializable(await albumService.list()));
  ipcMain.handle("album:create", async (_, payload) => toSerializable(await albumService.create(payload)));
  ipcMain.handle("album:update", async (_, payload) => toSerializable(await albumService.update(payload)));
  ipcMain.handle("album:delete-global", async (_, payload) => toSerializable(await albumService.deleteGlobal(payload)));
  ipcMain.handle("photo:update-customization", async (_, payload) => toSerializable(await metadataEditService.updateCustomization(payload)));
  ipcMain.handle("photo:batch-update", async (_, payload) => toSerializable(await metadataEditService.batchUpdate(payload)));

  ipcMain.handle("photo:copy-path", async (_, mediaId) => {
    try {
      const { absolutePath } = resolveIndexedMediaPath(mediaId);
      clipboard.writeText(absolutePath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle("clipboard:write-text", async (_, value) => {
    clipboard.writeText(String(value ?? ""));
    return { ok: true };
  });
  ipcMain.handle("photo:copy-json", async (_, mediaId) => {
    try {
      const { item } = resolveIndexedMediaPath(mediaId);
      clipboard.writeText(JSON.stringify(item, null, 2));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle("photo:copy-image", async (_, mediaId) => {
    try {
      const resolved = resolveIndexedMediaPath(mediaId);
      if (resolved.item?.FileSystem?.FileType !== "image") return { ok: false, error: "Only images can be copied" };
      const image = nativeImage.createFromPath(resolved.absolutePath);
      if (image.isEmpty()) return { ok: false, error: "Image load failed" };
      clipboard.writeImage(image);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle("photo:open-default", async (_, mediaId) => {
    try {
      const { absolutePath } = resolveIndexedMediaPath(mediaId);
      const errorMessage = await shell.openPath(absolutePath);
      return errorMessage ? { ok: false, error: errorMessage } : { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle("photo:show-in-folder", async (_, mediaId) => {
    try {
      const { absolutePath } = resolveIndexedMediaPath(mediaId);
      shell.showItemInFolder(absolutePath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle("photo:report-playback", async (_, payload) => {
    const mediaId = String(payload?.mediaId || "").trim();
    const item = runtime.metadataIndex.get(mediaId);
    if (!item) return { ok: false };
    const mode = String(payload?.mode || "unknown").slice(0, 40);
    const message = String(payload?.message || "").replace(/\s+/g, " ").slice(0, 240);
    appendLog(`playback-fallback media=${mediaId} file=${item.FilePath} mode=${mode} message=${message}`);
    return { ok: true };
  });
  ipcMain.handle("window:action", async (_, action) => {
    const window = runtime.mainWindow;
    if (!window) return;
    if (action === "minimize") window.minimize();
    if (action === "maximize") window.maximize();
    if (action === "restore") window.unmaximize();
    if (action === "close") window.close();
  });
  ipcMain.handle("window:get-state", async () => ({ isMaximized: Boolean(runtime.mainWindow?.isMaximized()) }));
}

module.exports = { registerIpcHandlers };
