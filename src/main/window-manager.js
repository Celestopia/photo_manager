const fs = require("node:fs");

async function createMainWindow(options, dependencies = {}) {
  const {
    rendererIndexPath,
    preloadPath,
    appendLog,
    onCreated,
    isMaintenanceRunning,
    getInitializationWorker,
    cancelInitializationAndClose,
  } = options;
  const electron = dependencies.electron || require("electron");
  const BrowserWindowClass = electron.BrowserWindow;
  const dialog = electron.dialog;
  const rendererExists = dependencies.rendererExists || fs.existsSync;
  const window = new BrowserWindowClass({
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
  window.on("close", (event) => {
    if (isMaintenanceRunning()) {
      event.preventDefault();
      dialog.showMessageBoxSync(window, {
        type: "warning",
        title: "Maintenance Is Still Running",
        message: "The current library maintenance task cannot be cancelled. Wait for it to finish before closing the application.",
        buttons: ["OK"],
      });
      return;
    }
    const worker = getInitializationWorker();
    if (!worker) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(window, {
      type: "warning",
      title: "Cancel Library Initialization",
      message: "The library is still being initialized. Closing the application will cancel initialization and delete all incomplete data created during this attempt. Continue?",
      buttons: ["Continue Initialization", "Cancel Initialization and Close"],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 1) cancelInitializationAndClose(worker);
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
