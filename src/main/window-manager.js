const { BrowserWindow, dialog } = require("electron");
const fs = require("node:fs");

async function createMainWindow(options) {
  const {
    rendererIndexPath,
    preloadPath,
    appendLog,
    onCreated,
    isMaintenanceRunning,
    getInitializationWorker,
    cancelInitializationAndClose,
  } = options;
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1000,
    minHeight: 700,
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
        title: "维护任务仍在运行",
        message: "当前图库维护任务不能取消。请等待任务完成后再关闭应用。",
        buttons: ["确定"],
      });
      return;
    }
    const worker = getInitializationWorker();
    if (!worker) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(window, {
      type: "warning",
      title: "取消图库初始化",
      message: "图库仍在初始化。关闭应用将取消初始化并删除本轮创建的全部未完成数据。是否继续？",
      buttons: ["继续初始化", "取消初始化并关闭"],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 1) cancelInitializationAndClose(worker);
  });

  if (fs.existsSync(rendererIndexPath)) {
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
  emitWindowState();
  return window;
}

module.exports = { createMainWindow };
