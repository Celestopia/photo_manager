const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { resolveLibraryPaths } = require('../scripts/library-core');
const { coverName } = require('../scripts/video-cover-cache');
const { ensureVideoCovers } = require('../scripts/build-video-covers');

test('batch covers deduplicate, reuse, repair, force, report changes and continue after decode errors', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-batch-covers-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const paths = resolveLibraryPaths(root);
  await fs.mkdir(paths.managerDir);
  const source = path.join(root, 'video.mp4');
  await fs.writeFile(source, 'fixture');
  const stat = await fs.stat(source);
  const item = { FilePath: 'video.mp4', SHA256Hash: 'a'.repeat(64), FileSystem: {
    FileType: 'video', FileSize: stat.size, ModificationTimeMs: stat.mtimeMs } };
  const bytes = await sharp({ create: { width: 32, height: 18, channels: 3, background: 'black' } }).webp().toBuffer();
  let calls = 0;
  const progress = [];
  const options = { paths, config: {}, logger: { warn() {} }, emit: p => progress.push(p),
    generate: async ({ hash, beforePublish }) => { calls++; await beforePublish(); await fs.writeFile(path.join(paths.videoCoverDir, coverName(hash)), bytes); } };
  assert.equal((await ensureVideoCovers([item, item], options)).generated, 1);
  assert.equal(calls, 1);
  assert.equal(progress.at(-1).total, 1);
  assert.equal((await ensureVideoCovers([item], options)).skipped, 1);
  await fs.writeFile(path.join(paths.videoCoverDir, coverName(item.SHA256Hash)), 'corrupt');
  assert.equal((await ensureVideoCovers([item], options)).generated, 1);
  assert.equal((await ensureVideoCovers([item], { ...options, force: true })).generated, 1);
  const failing = { ...options, force: true, generate: async () => { throw new Error('decode error'); } };
  assert.equal((await ensureVideoCovers([item], failing)).failed, 1);
  assert.deepEqual(await fs.readFile(path.join(paths.videoCoverDir, coverName(item.SHA256Hash))), bytes);
  await assert.rejects(ensureVideoCovers([item], { ...failing, generate: async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } }), /disk full/);
  await fs.appendFile(source, 'changed');
  assert.equal((await ensureVideoCovers([item], options)).sourceChanged, 1);
  assert.equal((await ensureVideoCovers([], options)).total, 0);
});
