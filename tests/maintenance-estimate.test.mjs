import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaintenanceEstimate, formatMaintenanceTime } from '../src/renderer/domain/maintenance-estimate.mjs';

test('estimate warms up, rounds remaining time, resets by stage and freezes on completion', () => {
  let time = 0; const timer = createMaintenanceEstimate(() => time);
  for (let i = 0; i < 4; i++) { time = i * 2000; timer.update({ phase: 'inspect', processed: i * 10, total: 100 }); }
  assert.equal(timer.snapshot().estimate, 'About 14s remaining in this stage');
  time = 7000;
  assert.equal(timer.snapshot().estimate, 'About 13s remaining in this stage');
  assert.equal(timer.snapshot().elapsedMs, 7000);
  time = 8000;
  assert.equal(timer.snapshot().estimate, 'About 12s remaining in this stage');
  time = 17000;
  assert.equal(timer.snapshot().estimate, 'Estimating…');
  timer.update({ phase: 'metadata', processed: 0, total: 100 });
  assert.equal(timer.snapshot().estimate, 'Estimating…');
  timer.update({ phase: 'commit', processed: 100, total: 100 });
  assert.equal(timer.snapshot().estimate, 'Finishing…');
  timer.finish(); time = 50000;
  assert.deepEqual(timer.snapshot(), { elapsedMs: 17000, estimate: '' });
  timer.reset();
  assert.equal(timer.snapshot().elapsedMs, 0);
});

test('cache skips and unsampled video work never borrow image throughput', () => {
  let time = 0; const timer = createMaintenanceEstimate(() => time);
  for (let i = 0; i < 4; i++) {
    time = i * 2000;
    timer.update({ phase: 'thumbnails', processed: i * 100, total: 500, estimateWork: [
      { id: 'images', processed: i, total: 10 }, { id: 'videos', processed: 0, total: 4 },
    ] });
  }
  assert.equal(timer.snapshot().estimate, 'Estimating…');
  timer.update({ phase: 'thumbnails', estimateWork: [{ id: 'images', processed: 0, total: 0 }] });
  assert.equal(timer.snapshot().estimate, 'Estimating…');
});

test('unknown work and warning events preserve timing without a false estimate', () => {
  let time = 0; const timer = createMaintenanceEstimate(() => time);
  timer.update({ phase: 'scan', processed: 30 });
  time = 12000; timer.update({ level: 'warning', message: 'warning' });
  assert.equal(timer.snapshot().estimate, 'Estimating…');
  assert.equal(timer.snapshot().elapsedMs, 12000);
  assert.equal(formatMaintenanceTime(84000), '1m 24s');
  assert.equal(formatMaintenanceTime(3660000), '1h 1m 0s');
});


test('an exhausted prediction returns to estimating instead of displaying zero', () => {
  let time = 0; const timer = createMaintenanceEstimate(() => time);
  for (let i = 0; i < 4; i++) { time = i * 2000; timer.update({ phase: 'work', processed: i, total: 4 }); }
  assert.equal(timer.snapshot().estimate, 'About 2s remaining in this stage');
  time = 7000;
  assert.equal(timer.snapshot().estimate, 'About 1s remaining in this stage');
  time = 8000;
  assert.equal(timer.snapshot().estimate, 'Estimating…');
});
