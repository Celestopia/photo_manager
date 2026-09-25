const { createWindowMessages } = require("./window-messages");
const fs = require("node:fs");
const path = require("node:path");

async function createMainWindow(options, dependencies = {}) {
  const {
    rendererIndexPath,
    preloadPath,
    appendLog,
    onCreated,
    isMaintenanceRunning,
    getInitializationWorker,
    cancelInitializationAndClose,
    prepareWindowClose,
  } = options;
  const electron = dependencies.electron || require("electron");
  const BrowserWindowClass = electron.BrowserWindow;
  const dialog = electron.dialog;
  const rendererExists = dependencies.rendererExists || fs.existsSync;
  const window = new BrowserWindowClass({
    icon: path.join(__dirname, "../../build/icon.ico"),
    width: 1600,
    height: 1000,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    frame: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  onCreated?.(window);
  const messages = createWindowMessages(window, electron);

  window.webContents.on("did-fail-load", (_, errorCode, errorDescription, validatedURL) => {
    const message = `did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedURL}`;
    console.error(message);
    appendLog(message);
  });
  window.webContents.on("render-process-gone", (_, details) => {
    const message = `render-process-gone reason=${details?.reason} exitCode=${details?.exitCode}`;
    console.error(message);
    appendLog(message);
  });
  window.webContents.on("unresponsive", () => {
    const message = "renderer became unresponsive";
    console.error(message);
    appendLog(message);
  });
  window.webContents.on("console-message", (_, level, message, line, sourceId) => {
    const logMessage = `renderer-console [${level}] ${message} @ ${sourceId}:${line}`;
    console.log(logMessage);
    appendLog(logMessage);
  });

  const emitWindowState = () => {
    if (window.isDestroyed()) return;
    window.webContents.send("window:state-changed", { isMaximized: window.isMaximized() });
  };
  window.on("maximize", emitWindowState);
  window.on("unmaximize", emitWindowState);
  window.on("enter-full-screen", emitWindowState);
  window.on("leave-full-screen", emitWindowState);
  let closePrepared = false;
  let closePreparation = null;
  window.on("close", (event) => {
    if (closePrepared) return;
    event.preventDefault();
    if (closePreparation) return;
    closePreparation = Promise.resolve().then(async () => {
      if (isMaintenanceRunning()) {
        await messages.request({ title: "Maintenance is still running", message: "Wait for the current maintenance task to finish before closing this window. This task cannot be cancelled.", notice: true, confirmLabel: "OK" });
        return;
      }
      const worker = getInitializationWorker();
      if (worker) {
        const accepted = await messages.request({ title: "Cancel initialization and close?", message: "Closing this window will cancel initialization and delete incomplete management data created during this attempt. Your original media files will remain unchanged.", cancelLabel: "Continue initialization", confirmLabel: "Cancel and close", danger: true });
        if (accepted && !window.isDestroyed() && getInitializationWorker() === worker && !isMaintenanceRunning()) cancelInitializationAndClose(worker);
        return;
      }
      await prepareWindowClose?.();
      if (!window.isDestroyed()) { closePrepared = true; window.close(); }
    }).catch(async error => {
      appendLog(`window close preparation failed: ${error?.stack || error?.message || error}`);
      if (!window.isDestroyed()) await messages.request({ title: "Could not close window", message: error?.message || "The library session could not be closed safely.", notice: true, confirmLabel: "OK" });
    }).catch(error => appendLog(`window close message failed: ${error?.message || error}`))
      .finally(() => { closePreparation = null; });
  });

  if (rendererExists(rendererIndexPath)) {
    await window.loadFile(rendererIndexPath);
  } else {
    const message = "Renderer bundle not found. Run `npm run build:renderer` first.";
    appendLog(message);
    await window.loadURL(
      `data:text/html;charset=UTF-8,${encodeURIComponent(
        `<h2 style="font-family:Segoe UI, Arial, sans-serif; padding: 20px;">${message}</h2>`,
      )}`,
    );
  }
  window.maximize();
  window.show();
  emitWindowState();
  return window;
}

module.exports = { createMainWindow };
