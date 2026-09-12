const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { registerApplicationWindowLifecycle } = require("../src/main/application-window-lifecycle.js");

test("a second application launch creates another window", async () => {
  const app = new EventEmitter();
  let created = 0;
  registerApplicationWindowLifecycle({
    app,
    BrowserWindow: { getAllWindows: () => [{}] },
    applicationReady: Promise.resolve(),
    createWindow: async () => { created += 1; },
    appendLog() {},
  });
  app.emit("second-instance");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created, 1);
});

test("activation recreates a window only when none remain", async () => {
  const app = new EventEmitter();
  let windows = [];
  let created = 0;
  registerApplicationWindowLifecycle({
    app,
    BrowserWindow: { getAllWindows: () => windows },
    applicationReady: Promise.resolve(),
    createWindow: async () => { created += 1; },
    appendLog() {},
  });
  windows = [{}];
  app.emit("activate");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created, 0);
  windows = [];
  app.emit("activate");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created, 1);
});
