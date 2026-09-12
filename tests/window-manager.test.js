const test = require("node:test");
const assert = require("node:assert/strict");

const { createMainWindow } = require("../src/main/window-manager.js");

test("main window is loaded before it is shown maximized", async () => {
  const actions = [];
  let browserWindowOptions;

  class FakeBrowserWindow {
    constructor(options) {
      browserWindowOptions = options;
      this.maximized = false;
      this.listeners = new Map();
      this.closeCalls = 0;
      this.webContents = {
        on: () => {},
        send: (channel, payload) => actions.push(["send", channel, payload]),
      };
    }

    on(event, listener) {
      this.listeners.set(event, listener);
    }

    async loadFile(filePath) {
      actions.push(["loadFile", filePath]);
    }

    maximize() {
      this.maximized = true;
      actions.push(["maximize"]);
    }

    show() {
      actions.push(["show"]);
    }

    isDestroyed() {
      return false;
    }

    isMaximized() {
      return this.maximized;
    }

    close() {
      this.closeCalls += 1;
    }
  }

  await createMainWindow({
    rendererIndexPath: "renderer.html",
    preloadPath: "preload.js",
    appendLog: () => {},
    isMaintenanceRunning: () => false,
    getInitializationWorker: () => null,
    cancelInitializationAndClose: () => {},
  }, {
    electron: { BrowserWindow: FakeBrowserWindow },
    rendererExists: () => true,
  });

  assert.equal(browserWindowOptions.show, false);
  assert.deepEqual(actions.slice(0, 3), [
    ["loadFile", "renderer.html"],
    ["maximize"],
    ["show"],
  ]);
  assert.deepEqual(actions.at(-1), [
    "send",
    "window:state-changed",
    { isMaximized: true },
  ]);
});

test("main window prepares its library session before closing", async () => {
  let window;
  let prepared = false;
  class FakeBrowserWindow {
    constructor() {
      window = this;
      this.listeners = new Map();
      this.webContents = { on() {}, send() {} };
      this.closeCalls = 0;
    }
    on(event, listener) { this.listeners.set(event, listener); }
    async loadFile() {}
    maximize() {}
    show() {}
    isDestroyed() { return false; }
    isMaximized() { return true; }
    close() { this.closeCalls += 1; }
  }
  await createMainWindow({
    rendererIndexPath: "renderer.html",
    preloadPath: "preload.js",
    appendLog() {},
    isMaintenanceRunning: () => false,
    getInitializationWorker: () => null,
    cancelInitializationAndClose() {},
    prepareWindowClose: async () => { prepared = true; },
  }, {
    electron: { BrowserWindow: FakeBrowserWindow, dialog: { showMessageBoxSync() {} } },
    rendererExists: () => true,
  });
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  window.listeners.get("close")(event);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(event.prevented, true);
  assert.equal(prepared, true);
  assert.equal(window.closeCalls, 1);
});
