import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLibraryDate, maintenanceSummary } from '../src/renderer/domain/library-presentation.mjs';

test('library dates use readable local time and tolerate unavailable values', () => {
  const local = new Date(2026, 6, 13, 1, 11);
  assert.equal(formatLibraryDate(local.toISOString()), '2026-07-13 01:11');
  assert.equal(formatLibraryDate(null), '—');
  assert.equal(formatLibraryDate('invalid'), '—');
});

test('maintenance summaries distinguish clean verification, reported issues and operation failure', () => {
  const clean = { checked: 557, missing: 0, extra: 0, tampered: 0, typeMismatch: 0, probeFailed: 0, probeChanged: 0, readFailed: 0, privacyInvalid: 0, warnings: [], errors: [] };
  assert.equal(maintenanceSummary('verify', clean).text, '557 media checked · No issues found');
  for (const field of ['missing', 'extra', 'tampered', 'probeChanged', 'privacyInvalid']) {
    const summary = maintenanceSummary('verify', { ...clean, [field]: 1 });
    assert.equal(summary.needsAttention, true);
    assert.ok(!summary.text.includes('No issues found'));
  }
  assert.equal(maintenanceSummary('verify', { ...clean, warnings: ['warning'] }).needsAttention, true);
  assert.equal(maintenanceSummary('verify', null).text, '');
  assert.deepEqual(maintenanceSummary('verify', null, 'Cannot read library'), { title: 'Operation failed', text: 'Cannot read library', needsAttention: true });
});

test('maintenance summaries use operation counters without inventing missing counts', () => {
  assert.equal(maintenanceSummary('export', { rows: 1234 }).text, '1,234 rows exported');
  assert.equal(maintenanceSummary('thumbnails', { generated: 4, skipped: 5, failed: 0 }).text, '4 generated · 5 reused · 0 failed');
  assert.equal(maintenanceSummary('video-covers', { generated: 4, sourceChanged: 1 }).needsAttention, true);
  assert.equal(maintenanceSummary('update', { total: 10, rebuilt: 2, reused: 8 }).text, '10 media · 2 rebuilt · 8 unchanged');
});
