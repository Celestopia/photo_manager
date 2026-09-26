const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

// Exercise the owning function without booting Electron or creating another runtime abstraction.
function fixture(spawnError) {
  const source = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  const body = source.slice(source.indexOf('function runOperationWorker('), source.indexOf('\nasync function runMaintenanceOperation('));
  const worker = new EventEmitter();
  const state = { activeLibrary: { sessionId: 'test' }, pendingWindowClose: true };
  let finishes = 0, destroys = 0;
  const session = { runtime: { mainWindow: { destroy() { destroys++; } } } };
  const context = { state, sessionRouter: { current: () => session, run: (_, fn) => fn() }, path,
    APP_CODE_ROOT: '.', PROGRAM_RESOURCE_ROOT: '.', PROGRAM_RESOURCE_ROOT_ENV: 'TEST_ROOT',
    app: { getVersion: () => 'test' }, process: { env: {} },
    createOperationLog: () => ({ progress() {}, output() {}, finish() { finishes++; } }),
    appendOperationLog() {}, toSerializable: value => value, setImmediate,
    fork: () => { if (spawnError) throw spawnError; return worker; } };
  vm.runInNewContext(body, context);
  return { worker, state, start: () => context.runOperationWorker('thumbnails', 'test-library'),
    finishes: () => finishes, destroys: () => destroys };
}

test('maintenance waits for delayed IPC after exit and cleans up once at close', async () => {
  const f = fixture();
  let settled = false;
  const pending = f.start();
  pending.then(() => { settled = true; });
  f.worker.emit('exit', 0, null);
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(f.state.activeWorker, f.worker);
  assert.equal(f.finishes(), 0);
  const result = { total: 557, skipped: 557 };
  f.worker.emit('message', { type: 'result', result });
  f.worker.emit('close', 0, null);
  assert.equal(await pending, result);
  f.worker.emit('close', 0, null);
  await new Promise(setImmediate);
  assert.equal(f.state.activeWorker, null);
  assert.equal(f.finishes(), 1);
  assert.equal(f.destroys(), 1);
});

test('spawn error waits for close cleanup and preserves its cause', async () => {
  const f = fixture();
  const pending = f.start();
  const rejected = assert.rejects(pending, { code: 'ENOENT', message: 'spawn failed' });
  f.worker.emit('error', Object.assign(new Error('spawn failed'), { code: 'ENOENT' }));
  assert.equal(f.state.activeWorker, f.worker);
  f.worker.emit('close', -2, null);
  await rejected;
  assert.equal(f.state.activeWorker, null);
  assert.equal(f.finishes(), 1);
});

test('clean exit without a result still fails and synchronous spawn failure is logged', async () => {
  const f = fixture();
  const rejected = assert.rejects(f.start(), /worker exited with code 0/);
  f.worker.emit('close', 0, null);
  await rejected;
  const sync = fixture(new Error('cannot spawn'));
  await assert.rejects(sync.start(), /cannot spawn/);
  assert.equal(sync.finishes(), 1);
  assert.equal(sync.state.activeWorker, undefined);
});
