const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createOperationLog, formatLog, appendDailyLog } = require('../src/core/operation-log');

test('operation logs throttle progress, preserve warnings, summarize counts and omit arbitrary payloads', () => {
  let time = 0;
  const lines = [];
  const log = createOperationLog({ operation: 'video-covers', version: 'test', options: { force: true, apiKey: 'private-value' }, write: line => lines.push(line), now: () => time });
  const progress = { phase: 'covers', processed: 1, total: 100, current: 'Camera/北京.mp4', generated: 1 };
  log.progress(progress);
  time = 100; log.progress({ ...progress, processed: 2 });
  assert.equal(lines.length, 2);
  time = 2000; log.progress({ ...progress, processed: 20 });
  log.progress({ level: 'warning', message: 'file unreadable', rawConfig: 'private-value' });
  log.progress({ phase: 'reload', processed: 0, total: 1 });
  log.finish({ generated: 2, skipped: 98, failed: 0, warnings: ['file unreadable'], prompt: 'private-value' }, null, 0);
  log.finish({}, null, 0);
  assert.equal(lines.length, 6);
  assert.match(lines.at(-1), /outcome="partial"/);
  assert.match(lines.at(-1), /skipped=98/);
  assert.match(lines.at(-1), /elapsedMs=2000/);
  assert.match(lines[1], /北京/);
  assert.match(lines[1], /progress=1\/100/);
  assert.match(lines[4], /progress=0\/1/);
  assert.doesNotMatch(lines[1], /processed=|total=/);
  assert.ok(lines.every(line => !line.includes('private-value')));
  assert.equal(new Set(lines.map(line => line.match(/run="([^"]+)"/)[1])).size, 1);
});

test('failure logs preserve worker stack, code, exit signal and only one terminal entry', () => {
  const lines = [];
  const log = createOperationLog({ operation: 'update', write: line => lines.push(line) });
  log.finish(null, { code: 'EIO', message: 'disk error', stack: 'Error: disk error\n at worker.js:42' }, 1, 'SIGTERM');
  log.finish(null, null, 1);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /worker.js:42/);
  assert.match(lines[1], /exitCode=1/);
  assert.match(lines[1], /SIGTERM/);
  assert.ok(!lines[1].includes('\n'));
});

test('daily logs isolate destinations, escape line breaks and redact common credential formats', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-logs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const a = path.join(root, 'a'), b = path.join(root, 'b');
  appendDailyLog(a, formatLog('error', 'failure', { message: '北京\nAuthorization: Bearer secret-value api_key=hidden' }));
  appendDailyLog(b, 'second library');
  const read = async dir => fs.readFile(path.join(dir, (await fs.readdir(dir))[0]), 'utf8');
  const first = await read(a);
  assert.ok(!first.includes('secret-value') && !first.includes('hidden'));
  assert.equal(first.trim().split('\n').length, 1);
  assert.match(first, /北京/);
  assert.ok(!(await read(b)).includes('北京'));
  assert.doesNotThrow(() => appendDailyLog('\0', 'unwritable'));
});


test('progress formatting retains standalone counts and handles empty work', () => {
  assert.match(formatLog('info', 'progress', { processed: 482, total: 557 }), /progress=482\/557$/);
  assert.match(formatLog('info', 'progress', { processed: 0, total: 0 }), /progress=0\/0$/);
  assert.match(formatLog('info', 'progress', { processed: 12 }), /processed=12$/);
  assert.match(formatLog('info', 'complete', { total: 557 }), /total=557$/);
});
