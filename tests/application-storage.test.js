const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  resolveApplicationPaths,
  ensureApplicationDirectories,
  configureElectronStoragePaths,
} = require("../src/core/application-paths.js");
const {
  loadApplicationState,
  saveApplicationState,
} = require("../src/main/application-state.js");

test("global application paths separate roaming configuration from machine-local state", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-manager-global-paths-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const roamingBase = path.join(tempDir, "Roaming");
  const localBase = path.join(tempDir, "Local");
  const paths = resolveApplicationPaths({ APPDATA: roamingBase, LOCALAPPDATA: localBase });

  assert.equal(paths.configFile, path.join(roamingBase, "PhotoManager", "app-data", "config.yml"));
  assert.equal(paths.electronUserDataDir, path.join(roamingBase, "PhotoManager", "electron"));
  assert.equal(paths.stateFile, path.join(localBase, "PhotoManager", "app-data", "state.json"));
  assert.equal(paths.logsDir, path.join(localBase, "PhotoManager", "logs"));
  assert.equal(paths.sessionDataDir, path.join(localBase, "PhotoManager", "session-data"));
  assert.equal(paths.crashDumpsDir, path.join(localBase, "PhotoManager", "crash-dumps"));

  ensureApplicationDirectories(paths);
  for (const directory of [
    paths.configDir,
    paths.electronUserDataDir,
    paths.localAppDataDir,
    paths.logsDir,
    paths.sessionDataDir,
    paths.crashDumpsDir,
  ]) {
    assert.equal(fs.statSync(directory).isDirectory(), true);
  }
});

test("global application paths require both Windows application-data roots", () => {
  assert.throws(
    () => resolveApplicationPaths({ APPDATA: "C:\\Roaming" }),
    (error) => error.code === "APPLICATION_DATA_PATH_UNAVAILABLE" && /LOCALAPPDATA/.test(error.message),
  );
  assert.throws(
    () => resolveApplicationPaths({ LOCALAPPDATA: "C:\\Local" }),
    (error) => error.code === "APPLICATION_DATA_PATH_UNAVAILABLE" && /APPDATA/.test(error.message),
  );
});

test("Electron storage paths are configured before application startup", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-manager-electron-paths-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const paths = resolveApplicationPaths({
    APPDATA: path.join(tempDir, "Roaming"),
    LOCALAPPDATA: path.join(tempDir, "Local"),
  });
  const calls = [];
  const app = {
    setPath: (name, value) => calls.push(["setPath", name, value]),
    setAppLogsPath: (value) => calls.push(["setAppLogsPath", value]),
  };

  configureElectronStoragePaths(app, paths);

  assert.deepEqual(calls, [
    ["setPath", "userData", paths.electronUserDataDir],
    ["setPath", "sessionData", paths.sessionDataDir],
    ["setPath", "crashDumps", paths.crashDumpsDir],
    ["setAppLogsPath", paths.logsDir],
  ]);
});

test("application state round-trips atomically in the local application-data directory", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-manager-state-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const stateFile = path.join(tempDir, "app-data", "state.json");

  assert.deepEqual(await loadApplicationState(stateFile), { lastLibraryPath: "" });
  await saveApplicationState(stateFile, { lastLibraryPath: "D:\\Media\\Library", ignored: true });
  assert.deepEqual(await loadApplicationState(stateFile), { lastLibraryPath: "D:\\Media\\Library" });
  await saveApplicationState(stateFile, { lastLibraryPath: "E:\\Photos" });
  assert.deepEqual(await loadApplicationState(stateFile), { lastLibraryPath: "E:\\Photos" });
  assert.deepEqual(fs.readdirSync(path.dirname(stateFile)), ["state.json"]);

  fs.writeFileSync(stateFile, "{broken", "utf8");
  assert.deepEqual(await loadApplicationState(stateFile), { lastLibraryPath: "" });
});

test("application state preserves the previous file and removes staging after a failed replacement", async t => {
  const fsp = require('node:fs/promises');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-manager-state-failure-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const destination = path.join(root, 'state.json');
  await saveApplicationState(destination, { lastLibraryPath: 'D:\\Original' });
  const before = fs.readFileSync(destination);
  const rename = fsp.rename;
  fsp.rename = async (from, to) => {
    if (to === destination) throw new Error('Replacement denied');
    return rename(from, to);
  };
  try { await assert.rejects(saveApplicationState(destination, { lastLibraryPath: 'E:\\New' }), /Replacement denied/); }
  finally { fsp.rename = rename; }
  assert.deepEqual(fs.readFileSync(destination), before);
  assert.deepEqual(fs.readdirSync(root), ['state.json']);
});
