/** Register OS launch/activation events that create independent entry windows. */
function registerApplicationWindowLifecycle({ app, BrowserWindow, applicationReady, createWindow, appendLog }) {
  function requestWindow(reason) {
    void applicationReady
      .then(() => createWindow())
      .catch((error) => appendLog(`${reason} window creation failed: ${error?.stack || error?.message || error}`));
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) requestWindow("activation");
  });
  app.on("second-instance", () => requestWindow("second-launch"));
}

module.exports = { registerApplicationWindowLifecycle };
