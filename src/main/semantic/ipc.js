const { dialog } = require("electron");
const { createModelAssets } = require("./model-assets");
const { status } = require("./index-store");
function registerSemanticIpc({
  ipcMain,
  runWithSession,
  getSession,
  modelsRoot,
}) {
  const models = createModelAssets(modelsRoot);
  let owner = null;
  function library(session) {
    const lib = session.runtime.activeLibrary;
    if (!session.acceptingCommands || !lib || lib.state !== "open")
      throw new Error("No open library");
    return lib;
  }
  const handle = (name, fn) =>
    ipcMain.handle("semantic:" + name, (event, payload) =>
      runWithSession(event, () => fn(getSession(), payload)),
    );
  handle("status", async (session) => {
    const lib = library(session);
    let index,
      error = "";
    try {
      index = await status(
        lib.paths,
        lib.manifest.libraryId,
        [...session.runtime.metadataIndex.values()],
        {
          albums: session.runtime.albumRegistryIndex,
          tags: session.runtime.tagRegistryIndex,
          people: session.runtime.personRegistryIndex,
          locations: session.runtime.locationRegistryIndex,
        },
      );
    } catch (e) {
      error = e.message;
    }
    return { models: await models.status(), index, error };
  });
  handle("install", async (session, mode) => {
    library(session);
    if (!["download", "import"].includes(mode))
      throw new Error("Invalid model operation");
    if (owner) throw new Error("A model installation is already running");
    if (session.runtime.maintenanceState.running)
      throw new Error("Maintenance is running");
    owner = session;
    const controller = new AbortController();
    session.semanticInstallation = controller;
    try {
      let importRoot;
      if (mode === "import") {
        const selected = await dialog.showOpenDialog(
          session.runtime.mainWindow,
          {
            title:
              "Choose model folder containing repository/revision directories",
            properties: ["openDirectory"],
          },
        );
        if (selected.canceled) return null;
        importRoot = selected.filePaths[0];
      }
      return await models.install({
        importRoot,
        signal: controller.signal,
        onProgress: (p) => {
          const win = session.runtime.mainWindow;
          if (win && !win.isDestroyed())
            win.webContents.send("semantic:progress", p);
        },
      });
    } finally {
      owner = null;
      session.semanticInstallation = null;
    }
  });
  handle("cancel", (session) => {
    session.semanticInstallation?.abort();
    if (session.runtime.activeWorkerOperation === "semantic-index")
      session.runtime.activeWorker?.send({ type: "cancel" });
  });
}
module.exports = { registerSemanticIpc };
