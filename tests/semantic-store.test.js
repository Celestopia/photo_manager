const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { resolveLibraryPaths } = require('../scripts/library-core');
const { dimensions, profiles, hash } = require('../src/main/semantic/domain');
const store = require('../src/main/semantic/index-store');
const { rank } = require('../src/main/semantic/vector-search-worker');

function unit(lane, axis) {
  const vector = new Float32Array(dimensions[lane]);
  vector[axis] = 1;
  return vector;
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const paths = resolveLibraryPaths(root), libraryId = randomUUID(), entries = new Map();
  async function entry(mediaId, lane, axes) {
    const blob = await store.writeVectors(paths, lane, axes.map(axis => unit(lane, axis)));
    const row = { mediaId, lane, profile: profiles[lane], inputHash: hash(mediaId + lane),
      blob, count: axes.length, expected: axes.length, parts: axes.map((_, i) => i) };
    entries.set(mediaId + ':' + lane, row);
    return row;
  }
  return { paths, libraryId, entries, entry };
}

test('semantic generations validate identity, integrity and normalized vector objects', async t => {
  const f = await fixture(t);
  const row = await f.entry(randomUUID(), 'visual', [0]);
  assert.equal(await store.readIndex(f.paths, f.libraryId), null);
  await store.publish(f.paths, f.libraryId, f.entries);
  const index = await store.readIndex(f.paths, f.libraryId);
  assert.deepEqual(index.entries, [row]);
  await assert.rejects(store.readIndex(f.paths, randomUUID()), /identity/);
  await assert.rejects(store.writeVectors(f.paths, 'visual', [new Float32Array(512)]), /norm/);
  const object = path.join(f.paths.semanticDir, 'objects', row.blob + '.f32');
  await fs.writeFile(object, Buffer.from('damaged'));
  await assert.rejects(store.readVectors(f.paths, row), /Corrupt/);
  await store.writeVectors(f.paths, 'visual', [unit('visual', 0)]);
  assert.equal((await store.readVectors(f.paths, row))[0][0], 1);
  const manifest = path.join(f.paths.semanticDir, 'generations', index.generation + '.json');
  await fs.appendFile(manifest, ' ');
  await assert.rejects(store.readIndex(f.paths, f.libraryId), /Corrupt/);
});

test('semantic ranking uses best video frame, eligible IDs and newly published generations', async t => {
  const f = await fixture(t), video = randomUUID(), photo = randomUUID(), excluded = randomUUID();
  await f.entry(video, 'visual', [1, 0]);
  await f.entry(photo, 'visual', [1]);
  await f.entry(excluded, 'visual', [0]);
  await f.entry(photo, 'description', [0]);
  await store.publish(f.paths, f.libraryId, f.entries);
  const request = { paths: f.paths, libraryId: f.libraryId, ids: [video, photo],
    queries: { visual: [unit('visual', 0)], description: [unit('description', 0)] } };
  // Both categories contribute: photo's metadata wins despite video's stronger visual score.
  assert.deepEqual(await rank(request), [photo, video]);
  assert.deepEqual(await rank({ ...request, queries: { visual: [unit('visual', 0)] } }), [video, photo]);
  const previous = await store.readIndex(f.paths, f.libraryId);
  f.entries.delete(photo + ':description');
  f.entries.delete(photo + ':visual');
  await store.publish(f.paths, f.libraryId, f.entries);
  const current = await store.readIndex(f.paths, f.libraryId);
  assert.deepEqual(await rank(request), [video]);
  await store.prune(f.paths, current, previous);
  assert.equal((await store.readIndex(f.paths, f.libraryId)).generation, current.generation);
  assert.equal((await store.readVectors(f.paths, previous.entries.find(e => e.mediaId === photo)))[0].length, 512);
});
