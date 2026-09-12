const test = require("node:test");
const assert = require("node:assert/strict");
const { createWindowSessionRouter } = require("../src/main/window-session-router.js");

function createSession(id, value) {
  const webContents = { id, mainFrame: { id: `frame-${id}` } };
  return { runtime: { mainWindow: { webContents }, value }, acceptingCommands: true, pendingOperations: new Set() };
}

test("window session router preserves concurrent IPC ownership across awaits", async () => {
  const router = createWindowSessionRouter();
  const first = router.register(createSession(1, "first"));
  const second = router.register(createSession(2, "second"));
  const runtime = router.createProxy((session) => session.runtime, "runtime");
  const eventFor = (session) => ({ sender: session.runtime.mainWindow.webContents, senderFrame: session.runtime.mainWindow.webContents.mainFrame });

  const values = await Promise.all([first, second].map((session) => router.runForEvent(eventFor(session), async () => {
    await new Promise((resolve) => setImmediate(resolve));
    return runtime.value;
  })));

  assert.deepEqual(values, ["first", "second"]);
  assert.equal(first.pendingOperations.size, 0);
  assert.equal(second.pendingOperations.size, 0);
  assert.equal(router.current({ optional: true }), null);
});

test("window session router rejects unknown and subframe senders", () => {
  const router = createWindowSessionRouter();
  const session = router.register(createSession(7, "owned"));
  assert.throws(() => router.resolveEvent({ sender: { id: 8 } }), /Invalid or closed/);
  assert.throws(() => router.resolveEvent({
    sender: session.runtime.mainWindow.webContents,
    senderFrame: { id: "subframe" },
  }), /main frame/);
  assert.equal(router.unregister(session), true);
  assert.throws(() => router.resolveEvent({ sender: session.runtime.mainWindow.webContents }), /Invalid or closed/);
});

test("window session router stops accepting commands during close", async () => {
  const router = createWindowSessionRouter();
  const session = router.register(createSession(11, "open"));
  const event = { sender: session.runtime.mainWindow.webContents };
  session.acceptingCommands = false;
  assert.throws(() => router.runForEvent(event, () => "late"), /window is closing/i);
});

test("window session router unregisters after Electron destroys the window object", () => {
  const router = createWindowSessionRouter();
  const session = createSession(12, "closing");
  router.register(session);
  Object.defineProperty(session.runtime.mainWindow, "webContents", {
    configurable: true,
    get() { throw new TypeError("Object has been destroyed"); },
  });

  assert.equal(router.unregister(session), true);
  assert.deepEqual(router.sessions(), []);
});
