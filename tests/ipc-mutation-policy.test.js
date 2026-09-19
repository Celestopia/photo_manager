const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createMutationCoordinator } = require('../src/main/mutation-coordinator');
const { createWindowSessionRouter } = require('../src/main/window-session-router');

test('IPC requires session routing and orders writes without blocking reads or cancellation', async () => {
  const filename = path.resolve(__dirname, '../src/main/ipc-handlers.js');
  const localRequire = createRequire(filename), handlers = new Map(), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports,
    require: name => name === 'electron' ? { ipcMain: { handle: (name, handler) => handlers.set(name, handler) } }
      : name === './file-clipboard' ? {} : localRequire(name) });
  const register = module.exports.registerIpcHandlers;
  assert.throws(() => register({}), /session routing/);
  const router = createWindowSessionRouter();
  const sender = { id: 1 }, session = { runtime: { mainWindow: { webContents: sender } }, mutate: createMutationCoordinator() };
  router.register(session); let finish, started = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const runtime = { quickScanState: { cancelled: false } };
  register({ runtime, runWithSession: router.runForEvent, mutate: operation => router.current().mutate(operation), toSerializable: value => value,
    services: { tagService: { create: async () => { started++; await pending; assert.equal(router.current(), session); return { ok: true }; }, list: async () => [] } } });
  const first = handlers.get('tag:create')({ sender }, {}), second = handlers.get('tag:create')({ sender }, {});
  await Promise.resolve(); await Promise.resolve(); assert.equal(started, 1);
  assert.deepEqual(await handlers.get('tag:list')({ sender }), []);
  await handlers.get('library:cancel-scan')({ sender }); assert.equal(runtime.quickScanState.cancelled, true);
  assert.throws(() => handlers.get('tag:list')({ sender: { id: 2 } }), /Invalid or closed/);
  finish(); await Promise.all([first, second]); assert.equal(started, 2);
});
