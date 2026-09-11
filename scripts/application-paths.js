const fs = require("node:fs");
const path = require("node:path");

const APPLICATION_DIRECTORY_NAME = "PhotoManager";

function requireEnvironmentPath(environment, key) {
  const value = String(environment?.[key] || "").trim();
  if (value) return path.resolve(value);
  const error = new Error(`Cannot resolve application data because ${key} is unavailable`);
  error.code = "APPLICATION_DATA_PATH_UNAVAILABLE";
  throw error;
}

function resolveApplicationPaths(environment = process.env) {
  const roamingRoot = path.join(requireEnvironmentPath(environment, "APPDATA"), APPLICATION_DIRECTORY_NAME);
  const localRoot = path.join(requireEnvironmentPath(environment, "LOCALAPPDATA"), APPLICATION_DIRECTORY_NAME);
  return {
    roamingRoot,
    localRoot,
    configDir: path.join(roamingRoot, "app-data"),
    configFile: path.join(roamingRoot, "app-data", "config.yml"),
    electronUserDataDir: path.join(roamingRoot, "electron"),
    localAppDataDir: path.join(localRoot, "app-data"),
    stateFile: path.join(localRoot, "app-data", "state.json"),
    chatProviderFile: path.join(localRoot, "app-data", "chat-provider.yml"),
    logsDir: path.join(localRoot, "logs"),
    sessionDataDir: path.join(localRoot, "session-data"),
    crashDumpsDir: path.join(localRoot, "crash-dumps"),
  };
}

function ensureApplicationDirectories(paths) {
  for (const directory of [
    paths.configDir,
    paths.electronUserDataDir,
    paths.localAppDataDir,
    paths.logsDir,
    paths.sessionDataDir,
    paths.crashDumpsDir,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  return paths;
}

function configureElectronStoragePaths(app, paths) {
  ensureApplicationDirectories(paths);
  app.setPath("userData", paths.electronUserDataDir);
  app.setPath("sessionData", paths.sessionDataDir);
  app.setPath("crashDumps", paths.crashDumpsDir);
  app.setAppLogsPath(paths.logsDir);
}

module.exports = {
  APPLICATION_DIRECTORY_NAME,
  resolveApplicationPaths,
  ensureApplicationDirectories,
  configureElectronStoragePaths,
};
