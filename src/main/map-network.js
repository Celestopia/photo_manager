const configured = new WeakSet();
const ATTRIBUTION_URL = "https://www.openstreetmap.org/copyright";

function configureMapNetwork(window, { app, shell }) {
  const session = window.webContents.session;
  if (!configured.has(session)) {
    session.webRequest.onBeforeSendHeaders({ urls: ["https://tile.openstreetmap.org/*"] }, (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, "User-Agent": `PhotoManager/${app.getVersion()}` } });
    });
    configured.add(session);
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url === ATTRIBUTION_URL) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
}
module.exports = { configureMapNetwork };
