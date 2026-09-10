const { exact } = require("../../shared/agent-schema");
function registerAgentIpc({ ipcMain, shell, dialog, getWindow, agent, coordinator }) {
  const handle = (name, callback) => ipcMain.handle("agent:" + name, async (event, payload) => {
    if (event.sender !== getWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error("Untrusted agent IPC sender");
    try { if (name !== 'cancel') await coordinator?.drain(); return { ok: true, result: await callback(payload) }; }
    catch (error) { return { ok: false, error: String(error.message).slice(0, 500) }; }
  });
  handle("status", () => agent.status());
  handle("cancel", () => agent.cancel());
  handle("index", payload => agent.index(payload));
  handle("search", payload => agent.search(payload));
  handle("preview", payload => agent.preview(payload));
  handle("chat", payload => agent.chat(payload));
  handle("clear-chat", payload => agent.clearChat(payload));
  handle("verify", payload => agent.verify(payload));
  handle("apply", payload => agent.apply(payload));
  handle("discard", payload => agent.discard(payload));
  handle("revise", payload => agent.revise(payload));
  handle("history", () => agent.operations.list());
  handle("undo", payload => { exact(payload, ["operationId"]); if (agent.busy) throw new Error("Stop the active run first"); return agent.operations.undo(payload.operationId); });
  handle("reload-config", () => { if (agent.busy) throw new Error("Stop the active run first"); return agent.reload(); });
  handle("test-provider", () => agent.testProvider());
  handle("open-config", async () => { const error = await shell.openPath(agent.configFile); if (error) throw new Error(error); });
  handle("open-runtime-config", async () => { const error = await shell.openPath(agent.runtimeFile); if (error) throw new Error(error); });
  handle("download-models", () => agent.installModels({}));
  handle("import-models", async () => {
    const result = await dialog.showOpenDialog(getWindow(), { title: "Select the root containing the pinned Xenova model directories", properties: ["openDirectory"] });
    return result.canceled ? { canceled: true } : agent.installModels({ importRoot: result.filePaths[0] });
  });
}
module.exports = { registerAgentIpc };
