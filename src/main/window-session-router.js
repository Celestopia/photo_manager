const { AsyncLocalStorage } = require("node:async_hooks");

/**
 * Routes main-process work to the library session owned by one renderer.
 * AsyncLocalStorage keeps concurrent IPC requests isolated after awaits without
 * exposing window or session identifiers to renderer-controlled payloads.
 */
function createWindowSessionRouter() {
  const scope = new AsyncLocalStorage();
  const sessionsByWebContentsId = new Map();
  const registrationsBySession = new WeakMap();

  function register(session) {
    const webContents = session?.runtime?.mainWindow?.webContents;
    if (!Number.isInteger(webContents?.id)) throw new Error("Cannot register a window session without webContents");
    if (registrationsBySession.has(session)) throw new Error("This window session is already registered");
    if (sessionsByWebContentsId.has(webContents.id)) throw new Error("A window session is already registered for this renderer");
    sessionsByWebContentsId.set(webContents.id, session);
    registrationsBySession.set(session, { webContents, webContentsId: webContents.id });
    return session;
  }

  function unregister(session) {
    const registration = registrationsBySession.get(session);
    if (!registration) return false;
    registrationsBySession.delete(session);
    return sessionsByWebContentsId.get(registration.webContentsId) === session
      && sessionsByWebContentsId.delete(registration.webContentsId);
  }

  function current({ optional = false } = {}) {
    const session = scope.getStore();
    if (session || optional) return session || null;
    throw new Error("No window session is active for this operation");
  }

  function run(session, operation) {
    if (!session || typeof operation !== "function") throw new TypeError("A window session and operation are required");
    return scope.run(session, operation);
  }

  function resolveEvent(event) {
    const sender = event?.sender;
    const session = sessionsByWebContentsId.get(sender?.id);
    const registration = session && registrationsBySession.get(session);
    if (!registration || registration.webContents !== sender) throw new Error("Invalid or closed window sender");
    if (event.senderFrame && sender.mainFrame && event.senderFrame !== sender.mainFrame) throw new Error("Window commands must originate from the main frame");
    return session;
  }

  function runForEvent(event, operation) {
    const session = resolveEvent(event);
    if (session.acceptingCommands === false) throw new Error("This window is closing");
    const task = Promise.resolve(run(session, () => operation(session)));
    session.pendingOperations?.add(task);
    return task.finally(() => session.pendingOperations?.delete(task));
  }

  function createProxy(select, label = "window session value") {
    return new Proxy({}, {
      get(_target, property) {
        const selected = select(current());
        if (!selected) throw new Error(`Missing ${label}`);
        const value = selected[property];
        return typeof value === "function" ? value.bind(selected) : value;
      },
      set(_target, property, value) {
        const selected = select(current());
        if (!selected) throw new Error(`Missing ${label}`);
        selected[property] = value;
        return true;
      },
    });
  }

  return {
    register,
    unregister,
    current,
    run,
    resolveEvent,
    runForEvent,
    createProxy,
    sessions: () => [...sessionsByWebContentsId.values()],
  };
}

module.exports = { createWindowSessionRouter };
