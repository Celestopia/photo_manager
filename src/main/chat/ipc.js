const { ipcMain, dialog, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { safePath } = require("./store");
const { object, id } = require("./schema");
function registerChatIpc({ chat, getWindow, configFile }) {
  const fields = {
    load: ["sessionId"], describe: ["sessionId", "input"],
    rename: ["sessionId", "title"], removeInput: ["sessionId", "attachmentId"],
    delete: ["sessionId"], importBytes: ["sessionId", "name", "bytes"],
    importFile: ["sessionId", "path"], choose: ["sessionId"],
  };
  const handlers = {
    open: () => chat.open(),
    create: () => chat.create(),
    load: (p) => chat.load(p.sessionId),
    describe: (p) => chat.describe(p.sessionId, p.input),
    send: (p) => chat.send(p),
    stop: () => chat.stop(),
    rename: (p) => chat.rename(p.sessionId, p.title),
    removeInput: (p) => chat.removeInput(p.sessionId, p.attachmentId),
    configuration: () => chat.configuration(),
    saveConfiguration: (p) => chat.saveConfiguration(p),
    test: () => chat.test(),
    openConfiguration: async () => {
      await chat.configuration();
      const error = await shell.openPath(configFile);
      if (error)
        throw new Error("Unable to open configuration in the default editor.");
    },
    delete: async (p) => {
      const result = await dialog.showMessageBox(getWindow(), {
        type: "warning",
        buttons: ["Cancel", "Delete conversation"],
        defaultId: 0,
        cancelId: 0,
        title: "Delete conversation?",
        message: "Delete this conversation and its imported attachments?",
        detail:
          "Original library files are preserved. Chat history is not backed up.",
      });
      return result.response === 1
        ? { deleted: true, ...(await chat.delete(p.sessionId)) }
        : { deleted: false };
    },
    importBytes: (p) => {
      if (
        !p ||
        !(p.bytes instanceof Uint8Array) ||
        p.bytes.byteLength > 20 * 1024 * 1024
      )
        throw new Error("Invalid or oversized attachment.");
      return chat.import(p.sessionId, String(p.name), p.bytes);
    },
    importFile: async (p) => {
      const file = await safePath(path.parse(p.path).root, p.path);
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024)
        throw new Error("Imported files must be at most 20 MiB.");
      return chat.import(
        p.sessionId,
        path.basename(file),
        await fs.readFile(file),
      );
    },
    choose: async (p) => {
      const result = await dialog.showOpenDialog(getWindow(), {
        title: "Attach image or text file",
        properties: ["openFile"],
        filters: [
          {
            name: "Images and UTF-8 text",
            extensions: [
              "jpg",
              "jpeg",
              "png",
              "webp",
              "bmp",
              "gif",
              "txt",
              "md",
              "csv",
              "json",
            ],
          },
        ],
      });
      if (result.canceled) return null;
      return handlers.importFile({
        sessionId: p.sessionId,
        path: result.filePaths[0],
      });
    },
  };
  for (const [name, fn] of Object.entries(handlers))
    ipcMain.handle(`chat:${name}`, async (event, p) => {
      if (
        event.sender !== getWindow()?.webContents ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw new Error("Invalid chat sender");
      try {
        if (fields[name]) {
          object(p, fields[name], "Chat command");
          id(p.sessionId);
        } else if (name !== "send" && name !== "saveConfiguration" && p !== undefined) {
          throw new Error("This chat command accepts no arguments.");
        }
        return { ok: true, value: await fn(p) };
      } catch (e) {
        return {
          ok: false,
          error: e.message?.slice(0, 500) || "Chat operation failed.",
        };
      }
    });
}
module.exports = { registerChatIpc };
