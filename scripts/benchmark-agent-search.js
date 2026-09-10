/** Synthetic vector-search benchmark. Never opens or modifies a user's media library. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
async function main() {
  const mixed = process.argv.includes('--mixed'), count = 10000, videoCount = mixed ? 2000 : 0;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photo-manager-vector-bench-'));
  try {
    const eligible = Array.from({ length: count }, () => ({ mediaId: crypto.randomUUID(), visualHash: 'a'.repeat(64), textHash: 'b'.repeat(64) }));
    const manifest = { shards: [] }; let pending = [], dimension = 0, rowsWritten = 0;
    async function flush() {
      if (!pending.length) return;
      const name = 'shard-' + manifest.shards.length, bytes = Buffer.alloc(pending.length * dimension * 4);
      pending.forEach((_, index) => bytes.writeFloatLE(1, (index * dimension + index % dimension) * 4));
      await fs.writeFile(path.join(root, name + '.f32'), bytes); await fs.writeFile(path.join(root, name + '.json'), JSON.stringify(pending));
      manifest.shards.push({ name, count: pending.length, dimension }); rowsWritten += pending.length; pending = [];
    }
    for (const lane of ['visual', 'description', 'context']) {
      await flush(); dimension = lane === 'visual' ? 512 : 384;
      for (let index = 0; index < count; index++) {
        const parts = lane === 'visual' && index < videoCount ? 120 : 1;
        for (let part = 0; part < parts; part++) {
          pending.push({ mediaId: eligible[index].mediaId, lane, inputHash: lane === 'visual' ? eligible[index].visualHash : eligible[index].textHash, part,
            timestamp: lane === 'visual' && parts > 1 ? part * 15 : null, start: lane === 'visual' ? null : 0, end: lane === 'visual' ? null : 1, complete: true, expected: parts });
          if (pending.length === 4096) await flush();
        }
      }
    }
    await flush();
    const queries = { visual: [Array.from({ length: 512 }, (_, i) => i === 0 ? 1 : 0)], description: [Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0)], context: [Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0)] };
    const timings = [];
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, '../src/main/agent/vector-search-worker.js'), { workerData: { generation: { directory: root, manifest }, queries, eligible, depth: 200 } });
        worker.once('message', message => { worker.terminate(); message.error ? reject(new Error(message.error)) : resolve(message.result); }); worker.once('error', reject);
      });
      if (Object.values(result).some(lane => lane.length !== 200 || new Set(lane.map(item => item.mediaId)).size !== 200)) throw new Error('Invalid candidate grouping');
      timings.push(Math.round(performance.now() - started));
    }
    console.log(JSON.stringify({ synthetic: true, media: count, videos: videoCount, vectors: rowsWritten, timingsMs: timings, maximumMs: Math.max(...timings), targetMs: mixed ? 15000 : 3000 }));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
