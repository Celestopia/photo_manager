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
  const options = { paths, config: {}, validateTools: async () => {}, logger: { warn() {} }, emit: p => progress.push(p),
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

test('cached runs avoid pixel decoding and tool validation; generation validates tools once', async t => {
  const cache = require('../scripts/video-cover-cache');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-cover-fast-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const paths = resolveLibraryPaths(root);
  await fs.mkdir(paths.videoCoverDir, { recursive: true });
  await fs.writeFile(path.join(root, 'video.mp4'), 'fixture');
  const stat = await fs.stat(path.join(root, 'video.mp4'));
  const item = { FilePath: 'video.mp4', SHA256Hash: 'b'.repeat(64), FileSystem: {
    FileType: 'video', FileSize: stat.size, ModificationTimeMs: stat.mtimeMs } };
  const bytes = await sharp({ create: { width: 32, height: 18, channels: 3, background: 'black' } }).webp().toBuffer();
  await fs.writeFile(path.join(paths.videoCoverDir, coverName(item.SHA256Hash)), bytes);
  let validations = 0, generations = 0;
  const options = { paths, config: {}, validateTools: async () => { validations++; },
    generate: async ({ beforePublish }) => { generations++; await beforePublish(); } };
  const originalRaw = sharp.prototype.raw;
  sharp.prototype.raw = function () { throw new Error('Unexpected pixel decode'); };
  try {
    assert.equal((await ensureVideoCovers([item], options)).skipped, 1);
    assert.equal(validations, 0);
    assert.equal(generations, 0);
  } finally { sharp.prototype.raw = originalRaw; }
  const second = { ...item, SHA256Hash: 'c'.repeat(64) };
  assert.equal((await ensureVideoCovers([item, second], { ...options, force: true })).generated, 2);
  assert.equal(validations, 1);
  assert.equal(generations, 2);
  await assert.rejects(ensureVideoCovers([second], { ...options, validateTools: async () => { throw new Error('tools unavailable'); } }), /tools unavailable/);
  const missing = { ...item, FilePath: 'missing.mp4' };
  assert.equal((await ensureVideoCovers([missing, item], options)).skipped, 1);
  const cover = path.join(paths.videoCoverDir, coverName(item.SHA256Hash));
  await fs.writeFile(cover, await sharp(bytes).png().toBuffer());
  await assert.rejects(cache.checkExistingCover(cover), /header/);
  await fs.writeFile(cover, await sharp({ create: { width: 2561, height: 1, channels: 3, background: 'black' } }).webp().toBuffer());
  await assert.rejects(cache.checkExistingCover(cover), /header/);
  await fs.writeFile(cover, '');
  await assert.rejects(cache.checkExistingCover(cover), /Invalid video cover file/);
});
