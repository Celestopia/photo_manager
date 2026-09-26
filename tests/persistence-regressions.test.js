const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const core = require('../src/core/library-core');
const { DEFAULT_CONFIG } = require('../src/core/application-config');
const { assertLibraryReady, recoverLibraryTransactions } = require('../src/core/library-recovery');
const { commitTextTransaction } = require('../src/core/library-transaction');

async function directory(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'photo-manager-regression-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('photo-manager-regression-'));
    await fsp.rm(root, { recursive: true, force: true });
  });
  return root;
}

async function library(t) {
  const paths = core.resolveLibraryPaths(await directory(t));
  await core.ensureLibraryDirectories(paths);
  const manifest = core.createLibraryManifest(paths.root, 'Regression fixture');
  await core.writeLibraryManifest(paths, manifest);
  for (const name of Object.values(core.DATA_FILE_NAMES)) await core.writeJsonlAtomic(path.join(paths.dataDir, name), []);
  return { paths, manifest };
}

test('metadata update restores an uncommitted staged deletion before scanning', async t => {
  const { paths, manifest } = await library(t);
  const source = path.join(paths.root, 'source.png');
  await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toFile(source);
  const record = await require('../src/core/common').buildMetadata(source, paths.root);
  await core.writeJsonlAtomic(paths.metadataFile, [record]);
  const transactionId = randomUUID();
  const relativeDirectory = path.join('temp', 'media-deletions', transactionId);
  const stage = path.join(relativeDirectory, 'source.png');
  await fsp.mkdir(path.join(paths.managerDir, relativeDirectory), { recursive: true });
  await fsp.rename(source, path.join(paths.managerDir, stage));
  await core.writeTextAtomic(paths.mediaDeletionFile, JSON.stringify({ Version: 1, TransactionId: transactionId,
    Reason: 'interrupted', CreatedAt: new Date().toISOString(), Phase: 'staged', Moved: 1,
    Directory: relativeDirectory, Media: [{ MediaId: record.MediaId, Source: record.FilePath, Stage: stage }] }));
  assert.throws(() => assertLibraryReady(paths), { code: 'RECOVERY_REQUIRED' });
  const parentSessionId = randomUUID();
  await core.writeTextAtomic(paths.lockFile, JSON.stringify({ LibraryId: manifest.libraryId, SessionId: parentSessionId }));
  const result = await require('../src/core/update-metadata').run({ paths, parentSessionId, config: DEFAULT_CONFIG,
    logger: { info() {}, warn() {}, error() {} } });
  assert.equal(result.total, 1);
  assert.equal(fs.existsSync(source), true);
  assert.equal((await core.readJsonlStrict(paths.metadataFile))[0].MediaId, record.MediaId);
  assert.doesNotThrow(() => assertLibraryReady(paths));
  assert.deepEqual(await recoverLibraryTransactions(paths), { deletion: { recovered: false }, transaction: { recovered: false } });
});

test('committed text transactions remain committed when journal or directory cleanup fails', async t => {
  for (const fault of ['journal', 'directory']) {
    await t.test(fault, async t => {
      const { paths } = await library(t);
      await fsp.writeFile(paths.metadataFile, 'before');
      const original = fsp.rm;
      fsp.rm = async (target, options) => {
        if (fault === 'journal' ? target === paths.transactionFile : options?.recursive && path.dirname(target) === paths.transactionDir) {
          throw Object.assign(new Error('cleanup unavailable'), { code: 'EPERM' });
        }
        return original(target, options);
      };
      let result;
      try { result = await commitTextTransaction(paths, [{ filePath: paths.metadataFile, text: 'after' }]); }
      finally { fsp.rm = original; }
      assert.equal(result.committed, true);
      assert.equal(result.cleanupPending, true);
      assert.equal(await fsp.readFile(paths.metadataFile, 'utf8'), 'after');
      if (fault === 'journal') assert.throws(() => assertLibraryReady(paths), { code: 'RECOVERY_REQUIRED' });
      await recoverLibraryTransactions(paths);
      assert.doesNotThrow(() => assertLibraryReady(paths));
      assert.equal(await fsp.readFile(paths.metadataFile, 'utf8'), 'after');
    });
  }
});

test('location deletion rejects a detached-child collision before backup or publication', async () => {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const row = (n, Name, ParentId) => ({ LocationId: id(n), Name, ParentId, Country: '', Province: '', City: '', Description: '',
    CreatedAt: '2026-09-19T00:00:00.000Z', UpdatedAt: '2026-09-19T00:00:00.000Z' });
  let registry = new Map([row(1, 'Parent', null), row(2, 'Room', id(1)), row(3, 'Room', null)].map(r => [r.LocationId, r]));
  const before = [...registry];
  let writes = 0;
  const service = require('../src/core/location-registry-service').createLocationRegistryService({
    getRegistry: () => registry, setRegistry: value => { registry = value; }, getMetadata: () => new Map(), requireOpenLibrary() {},
    prepareLibraryWrite: async () => { writes++; }, saveTransaction: async () => { writes++; }, appendLog() {},
  });
  const result = await service.deleteGlobal({ locationId: id(1) });
  assert.equal(result.ok, false);
  assert.match(result.error, /duplicate location context/);
  assert.equal(writes, 0);
  assert.deepEqual([...registry], before);
});

test('every read/cache maintenance entry refuses either unresolved journal', async t => {
  const { paths, manifest } = await library(t);
  const parentSessionId = randomUUID();
  await core.writeTextAtomic(paths.lockFile, JSON.stringify({ LibraryId: manifest.libraryId, SessionId: parentSessionId }));
  for (const journal of [paths.mediaDeletionFile, paths.transactionFile]) {
    await core.writeTextAtomic(journal, '{}');
    for (const script of ['verify-metadata', 'build-thumbnails', 'build-video-covers', 'export-metadata-csv']) {
      await assert.rejects(require('../src/core/' + script).run({ paths, parentSessionId, config: DEFAULT_CONFIG }), { code: 'RECOVERY_REQUIRED' });
    }
    await fsp.rm(journal);
  }
});

test('failed initialization validation does not leak a cancellation listener', async t => {
  const root = await directory(t);
  const listeners = process.listeners('message');
  await assert.rejects(require('../src/core/init-metadata').run({ paths: core.resolveLibraryPaths(path.join(root, 'missing')), config: DEFAULT_CONFIG }), /does not exist/);
  assert.deepEqual(process.listeners('message'), listeners);
});

async function compete(t, roots) {
  const children = roots.map(root => fork(path.join(__dirname, 'helpers/initialization-race.cjs'), [root], { silent: true }));
  t.after(() => children.forEach(child => { if (child.exitCode === null) child.kill(); }));
  const outcomes = children.map(child => new Promise((resolve, reject) => {
    let result;
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Initialization contention timed out')); }, 20000);
    child.on('message', message => { if ('ok' in message) result = message; });
    child.on('error', reject);
    child.on('exit', code => { clearTimeout(timeout); result ? resolve(result) : reject(new Error(`Initializer exited ${code}`)); });
  }));
  await Promise.all(children.map(child => new Promise((resolve, reject) => {
    child.on('message', message => { if (message.ready) resolve(); });
    child.once('error', reject);
  })));
  children.forEach(child => child.send({ start: true }));
  return Promise.all(outcomes);
}

test('competing initializer processes preserve the winner library', async t => {
  const root = await directory(t);
  const results = await compete(t, [root, root]);
  assert.equal(results.filter(result => result.ok).length, 1);
  const paths = core.resolveLibraryPaths(root);
  assert.equal((await core.readLibraryManifest(paths)).schemaVersion, core.LIBRARY_SCHEMA_VERSION);
  for (const name of Object.values(core.DATA_FILE_NAMES)) assert.deepEqual(await core.readJsonlStrict(path.join(paths.dataDir, name)), []);
  assert.equal(fs.existsSync(paths.initializationFile), false);
  assert.equal(fs.existsSync(paths.lockFile), false);
});

test('competing ancestor and descendant initialization cannot both succeed', async t => {
  const root = await directory(t);
  const child = path.join(root, 'child');
  await fsp.mkdir(child);
  const results = await compete(t, [root, child]);
  assert.ok(results.filter(result => result.ok).length <= 1);
});
