// Per-stage throughput estimates; clock injection keeps timing tests deterministic.
export function createMaintenanceEstimate(now = () => performance.now()) {
  let started = now(), phase, groups = new Map(), finished;
  function reset() { started = now(); phase = undefined; groups.clear(); finished = undefined; }
  function update(progress) {
    if (!progress?.phase || progress.level || finished !== undefined) return;
    if (phase !== progress.phase) { phase = progress.phase; groups.clear(); }
    const work = progress.estimateWork || [{ id: 'items', processed: progress.processed, total: progress.total }];
    for (const item of work) {
      if (!Number.isFinite(item.total) || !Number.isFinite(item.processed)) { groups.clear(); return; }
      let group = groups.get(item.id);
      if (!group || group.total !== item.total || item.processed < group.processed) {
        group = { total: item.total, processed: item.processed, samples: [{ time: now(), count: item.processed }], changed: now() };
        groups.set(item.id, group);
      } else if (item.processed !== group.processed) {
        group.processed = item.processed; group.changed = now();
        group.samples.push({ time: now(), count: item.processed });
        while (group.samples.length > 2 && now() - group.samples[1].time > 30000) group.samples.shift();
      }
    }
  }
  function snapshot() {
    const elapsedMs = (finished ?? now()) - started;
    if (finished !== undefined) return { elapsedMs, estimate: '' };
    if (['commit', 'write', 'complete'].includes(phase)) return { elapsedMs, estimate: 'Finishing…' };
    const remaining = [];
    for (const group of groups.values()) {
      if (group.processed >= group.total) continue;
      const first = group.samples[0], last = group.samples.at(-1);
      if (group.samples.length < 4 || last.time - first.time < 5000 || now() - group.changed > 10000) return { elapsedMs, estimate: 'Estimating…' };
      const rate = (last.count - first.count) / (last.time - first.time);
      const predictedMs = (group.total - group.processed) / rate - (now() - last.time);
      if (predictedMs <= 0) return { elapsedMs, estimate: "Estimating…" };
      remaining.push(predictedMs);
    }
    if (!groups.size || !remaining.length) return { elapsedMs, estimate: 'Estimating…' };
    const seconds = Math.max(1, Math.ceil(Math.max(...remaining) / 1000));
    return { elapsedMs, estimate: `About ${formatMaintenanceTime(seconds * 1000)} remaining in this stage` };
  }
  return { reset, update, snapshot, finish() { finished = now(); } };
}
export function formatMaintenanceTime(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m ${seconds % 60}s`;
}
