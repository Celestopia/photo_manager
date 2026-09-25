const { randomUUID } = require("node:crypto");

// Only the owning webContents can answer a pending window-close decision.
function createWindowMessages(window, { ipcMain, dialog }) {
  let ready = false, responsive = true, pending = null;
  const wc = window.webContents;
  const finish = accepted => { const current = pending; pending = null; current?.resolve(accepted === true); };
  const owns = event => event.sender === wc && (!event.senderFrame || event.senderFrame === wc.mainFrame);
  const onReady = event => { if (owns(event)) ready = true; };
  const onAnswer = (event, payload) => {
    if (owns(event) && pending && payload?.id === pending.id && typeof payload.accepted === "boolean") finish(payload.accepted);
  };
  ipcMain?.on("window:message-ready", onReady);
  ipcMain?.on("window:message-answer", onAnswer);
  function reset() { ready = false; finish(false); }
  wc.on("did-start-loading", reset);
  wc.on("render-process-gone", reset);
  wc.on("unresponsive", () => { responsive = false; finish(false); });
  wc.on("responsive", () => { responsive = true; if (!window.isDestroyed()) wc.send("window:message", { dismiss: true }); });
  window.on("closed", () => {
    finish(false);
    ipcMain?.removeListener("window:message-ready", onReady);
    ipcMain?.removeListener("window:message-answer", onAnswer);
  });
  async function request(options) {
    if (pending || window.isDestroyed()) return false;
    if (!ready || !responsive) {
      const buttons = options.notice ? [options.confirmLabel] : [options.cancelLabel || "Cancel", options.confirmLabel];
      const result = await dialog.showMessageBox(window, { title: options.title, message: options.message, type: options.danger ? "warning" : "info", buttons, defaultId: 0, cancelId: 0 });
      return options.notice || result.response === 1;
    }
    return new Promise(resolve => {
      const id = randomUUID(); pending = { id, resolve };
      try { wc.send("window:message", { id, options }); } catch (error) { finish(false); }
    });
  }
  return { request };
}
module.exports = { createWindowMessages };
