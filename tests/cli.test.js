const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Writable } = require('node:stream');
const { runCli } = require('../src/cli/main');
const { parseCommand } = require('../src/cli/arguments');
const core = require('../src/core/library-core');
const { acquireLibraryLock, releaseLibraryLock } = require('../src/core/library-lock');
const { buildMetadata } = require('../src/core/common');
const sharp = require('sharp');
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

async function fixture(t) {
  const base = path.resolve(__dirname, '../tmp'); await fs.mkdir(base, { recursive: true });
  const temp = await fs.mkdtemp(path.join(base, 'cli-test-'));
  t.after(async () => { assert.equal(path.dirname(temp), base); await fs.rm(temp, { recursive: true, force: true }); });
  const root = path.join(temp, '图库 space'); await fs.mkdir(root);
  const paths = core.resolveLibraryPaths(root);
  await core.ensureLibraryDirectories(paths);
  const manifest = core.createLibraryManifest(root, 'Test'); await core.writeLibraryManifest(paths, manifest);
  const date = '2026-09-26T00:00:00.000Z';
  const tag = { TagId: id(1), Text: '旅行', Description: '', CreatedAt: date, UpdatedAt: date };
  const location = { LocationId: id(2), Name: 'Campus', Country: '中国', Province: '', City: '北京', ParentId: null, Description: '', CreatedAt: date, UpdatedAt: date };
  const child = { ...location, LocationId: id(3), Name: 'Room', ParentId: id(2) };
  for (const [kind, entries] of Object.entries({ tags: [tag], albums: [], people: [], locations: [location, child] })) {
    await core.writeJsonlAtomic(path.join(paths.dataDir, core.DATA_FILE_NAMES[kind]), entries);
  }
  const records = [];
  for (let i = 0; i < 2; i++) {
    const file = path.join(root, `照片 ${i}.png`);
    await sharp({ create: { width: 2, height: 2, channels: 3, background: i ? 'blue' : 'red' } }).png().toFile(file);
    const item = await buildMetadata(file, root); item.MediaId = id(10 + i);
    item.Customization.Privacy = i ? 5 : 1; item.Customization.Title = `Photo ${i}`;
    item.Customization.TagIds = i ? [id(1)] : [];
    item.Location = { LocationId: i ? id(3) : null, Detail: '' }; records.push(item);
  }
  await core.writeJsonlAtomic(paths.metadataFile, records);
  const environment = { APPDATA: path.join(temp, 'roaming'), LOCALAPPDATA: path.join(temp, 'local') };
  async function run(args, options = {}) {
    let out = '', err = '';
    const stdout = new Writable({ write(chunk, encoding, done) { out += chunk; done(); } });
    const stderr = new Writable({ write(chunk, encoding, done) { err += chunk; done(); } });
    const code = await runCli([...args, '--library', root, '--format', 'json'], { stdout, stderr, stdin: { isTTY: false }, environment, ...options });
    return { code, out, err, result: out ? JSON.parse(out) : null };
  }
  return { temp, paths, manifest, records, run, environment };
}

test('CLI parser rejects unknown, misplaced, duplicate and missing options', () => {
  for (const args of [[], ['--help'], ['--version']]) assert.ok(parseCommand(args));
  for (const args of [['media', 'list'], ['media', 'list', '--library', 'x', '--bogus'],
    ['media', 'show', '--library', 'x', '--privacy', '1'], ['library', 'info', '--library', 'a', '--library', 'b'],
    ['media', 'delete', '--library', 'x'], ['media', 'list', '--library', 'x', '--format', 'xml']]) assert.throws(() => parseCommand(args), { code: 'USAGE' });
  assert.deepEqual(parseCommand(['media', 'list', '--library', 'x', '--rating', '3', '--rating', '5']).values.rating, ['3', '5']);
});

test('CLI queries all privacy levels and reuses descendant, name, unassigned and combined filters', async t => {
  const f = await fixture(t);
  assert.equal((await f.run(['media', 'list'])).result.total, 2);
  assert.equal((await f.run(['media', 'list', '--privacy', '1'])).result.total, 1);
  const selected = await f.run(['media', 'list', '--location', id(2), '--tag-name', '旅行']);
  assert.equal(selected.code, 0); assert.equal(selected.result.items[0].MediaId, id(11));
  assert.equal((await f.run(['media', 'list', '--tag', 'unassigned'])).result.items[0].MediaId, id(10));
  assert.equal((await f.run(['media', 'list', '--country', '中国', '--city', '北京'])).result.total, 1);
  const page = await f.run(['media', 'list', '--limit', '1', '--fields', 'MediaId,Customization.Title']);
  assert.equal(page.result.total, 2); assert.equal(page.result.returned, 1);
  assert.equal(Object.keys(page.result.items[0]).length, 2);
  const empty = await f.run(['media', 'list', '--search', 'absent']); assert.equal(empty.code, 0); assert.equal(empty.result.total, 0);
  assert.equal((await f.run(['media', 'list', '--rating', '7'])).code, 2);
  assert.equal((await f.run(['media', 'list', '--fields', 'wrong'])).code, 2);
});

test('CLI edits preview without writes, validate every target, and atomically persist a confirmed batch', async t => {
  const f = await fixture(t);
  const before = await fs.readFile(f.paths.metadataFile, 'utf8');
  const args = ['media', 'edit', '--id', id(10), '--id', id(11), '--title', '新 title', '--add-tag', id(1)];
  const preview = await f.run([...args, '--dry-run']); assert.equal(preview.code, 0); assert.equal(preview.result.updatedCount, 2);
  assert.equal(await fs.readFile(f.paths.metadataFile, 'utf8'), before);
  assert.equal((await fs.readdir(f.paths.backupDir)).length, 0);
  assert.equal((await f.run(args)).code, 2);
  assert.equal((await f.run(['media', 'edit', '--id', id(10), '--id', id(99), '--title', 'bad', '--yes'])).code, 1);
  assert.equal(await fs.readFile(f.paths.metadataFile, 'utf8'), before);
  const edited = await f.run([...args, '--yes']); assert.equal(edited.code, 0);
  const records = await core.readJsonlStrict(f.paths.metadataFile);
  assert.ok(records.every(item => item.Customization.Title === '新 title' && item.Customization.TagIds.includes(id(1))));
  assert.equal(records[0].SHA256Hash, f.records[0].SHA256Hash);
  assert.equal((await fs.readdir(f.paths.backupDir)).length, 1);
  assert.equal((await f.run(['media', 'edit', '--id', id(10), '--remove-tag', id(1)])).code, 0);
});

test('CLI JSON patches reject technical fields and preserve absent user fields', async t => {
  const f = await fixture(t), patch = path.join(f.temp, 'patch.json');
  await fs.writeFile(patch, JSON.stringify({ customization: { Description: '多行\ntext', TagIds: [] }, location: { Detail: 'room' } }));
  assert.equal((await f.run(['media', 'edit', '--id', id(11), '--patch-file', patch])).code, 0);
  const item = (await f.run(['media', 'show', '--id', id(11)])).result;
  assert.equal(item.Customization.Title, 'Photo 1'); assert.equal(item.Location.LocationId, id(3));
  await fs.writeFile(patch, JSON.stringify({ FileSystem: { FileSize: 4 } }));
  assert.equal((await f.run(['media', 'edit', '--id', id(11), '--patch-file', patch])).code, 1);
  await fs.writeFile(patch, JSON.stringify({ customization: { Rating: '4' } }));
  assert.equal((await f.run(['media', 'edit', '--id', id(11), '--patch-file', patch])).code, 1);
});

test('CLI registry operations share global deletion and location child rules', async t => {
  const f = await fixture(t);
  const created = await f.run(['registry', 'tag', 'create', '--name', 'Test', '--description', 'keep']);
  assert.equal(created.code, 0); const tagId = created.result.tag.TagId;
  const updated = await f.run(['registry', 'tag', 'update', '--id', tagId, '--name', 'Renamed']);
  assert.equal(updated.result.tag.Description, 'keep');
  assert.equal((await f.run(['registry', 'album', 'create', '--name', 'No description'])).code, 1);
  const preview = await f.run(['registry', 'tag', 'delete', '--id', id(1), '--dry-run']);
  assert.equal(preview.result.updatedCount, 1);
  assert.equal((await f.run(['registry', 'tag', 'delete', '--id', id(1)])).code, 2);
  assert.equal((await f.run(['registry', 'tag', 'delete', '--id', id(1), '--yes'])).code, 0);
  const deletion = await f.run(['registry', 'location', 'delete', '--id', id(2), '--yes']);
  assert.equal(deletion.result.orphanedChildren, 1);
  assert.equal((await f.run(['registry', 'location', 'show', '--id', id(3)])).result.ParentId, null);
});

test('CLI respects exclusive locks, refuses hidden recovery, and ignores inherited GUI authorization', async t => {
  const f = await fixture(t); const lock = await acquireLibraryLock(f.paths, f.manifest);
  const inherited = process.env.PHOTO_MANAGER_LIBRARY_SESSION;
  process.env.PHOTO_MANAGER_LIBRARY_SESSION = lock.SessionId;
  try {
    assert.equal((await f.run(['media', 'list'])).code, 3);
    assert.equal((await f.run(['maintenance', 'update'])).code, 3);
    assert.equal((await f.run(['library', 'unlock', '--yes'])).code, 3);
  } finally {
    if (inherited === undefined) delete process.env.PHOTO_MANAGER_LIBRARY_SESSION;
    else process.env.PHOTO_MANAGER_LIBRARY_SESSION = inherited;
    await releaseLibraryLock(f.paths, lock.SessionId);
  }
  await fs.writeFile(f.paths.transactionFile, '{}');
  assert.equal((await f.run(['media', 'list'])).code, 5);
  await fs.rm(f.paths.transactionFile);
  const controller = new AbortController(); controller.abort();
  assert.equal((await f.run(['media', 'edit', '--id', id(10), '--rating', '4'], { signal: controller.signal })).code, 130);
  await assert.rejects(fs.access(f.paths.lockFile));
  await assert.rejects(fs.access(path.join(f.environment.APPDATA, 'PhotoManager', 'electron')));
});

test('CLI export refuses library targets and confirms external overwrites', async t => {
  const f = await fixture(t);
  const before = await fs.readFile(f.paths.metadataFile);
  assert.equal((await f.run(['export', 'csv', '--output', f.paths.metadataFile, '--yes'])).code, 2);
  if (process.platform === 'win32') assert.equal((await f.run(['export', 'csv', '--output', f.paths.metadataFile.toUpperCase(), '--yes'])).code, 2);
  assert.deepEqual(await fs.readFile(f.paths.metadataFile), before);
  const output = path.join(f.temp, 'export.csv');
  assert.equal((await f.run(['export', 'csv', '--output', output])).code, 0);
  assert.equal((await f.run(['export', 'csv', '--output', output])).code, 2);
  assert.equal((await f.run(['export', 'csv', '--output', output, '--yes'])).code, 0);
  const other = path.join(f.temp, 'another library');
  await fs.mkdir(path.join(other, '.photo_manager'), { recursive: true });
  assert.equal((await f.run(['export', 'csv', '--output', path.join(other, 'photo.jpg'), '--yes'])).code, 2);
});

test('CLI recovery is explicit and name ambiguity never selects an arbitrary location', async t => {
  const f = await fixture(t);
  const created = await f.run(['registry', 'location', 'create', '--name', 'Campus', '--country', 'Canada']);
  assert.equal(created.code, 0);
  const ambiguous = await f.run(['media', 'list', '--location-name', 'Campus']);
  assert.equal(JSON.parse(ambiguous.err).error.code, 'AMBIGUOUS_NAME');
  assert.equal(JSON.parse(ambiguous.err).error.candidates.length, 2);
  await fs.writeFile(f.paths.transactionFile, JSON.stringify({ Version: 1, Phase: 'committed', Applied: 0, Targets: [] }));
  assert.equal((await f.run(['library', 'recover'])).code, 2);
  assert.equal((await f.run(['library', 'recover', '--yes'])).code, 0);
  await assert.rejects(fs.access(f.paths.transactionFile));
  assert.equal((await f.run(['library', 'info'])).code, 0);
});

test('CLI JSONL separates records from counts and verification failures use exit 4', async t => {
  const f = await fixture(t);
  let out = '', err = '';
  const stdout = new Writable({ write(chunk, encoding, done) { out += chunk; done(); } });
  const stderr = new Writable({ write(chunk, encoding, done) { err += chunk; done(); } });
  const code = await runCli(['media', 'list', '--library', f.paths.root, '--format', 'jsonl'], { stdout, stderr, environment: f.environment });
  assert.equal(code, 0);
  assert.equal(out.trim().split('\n').map(JSON.parse).length, 2);
  assert.match(err, /2 returned; 2 matched/);
  await fs.rm(path.join(f.paths.root, f.records[0].FilePath));
  assert.equal((await f.run(['maintenance', 'verify'])).code, 4);
});

test('cancelled metadata update does not publish records and releases its lock', async t => {
  const f = await fixture(t), controller = new AbortController();
  const before = await fs.readFile(f.paths.metadataFile);
  const { DEFAULT_CONFIG } = require('../src/core/application-config');
  await assert.rejects(require('../src/core/update-metadata').run({ paths: f.paths, config: structuredClone(DEFAULT_CONFIG),
    signal: controller.signal, logger: { info() {}, warn() {}, error() {} },
    onProgress: message => { if (message.phase === 'metadata') controller.abort(); },
  }), { name: 'AbortError' });
  assert.deepEqual(await fs.readFile(f.paths.metadataFile), before);
  await assert.rejects(fs.access(f.paths.lockFile));
});

test('core and CLI have no dependency on GUI modules or implicit process dispatch', async () => {
  for (const name of await fs.readdir(path.resolve(__dirname, '../src/core'))) {
    const text = await fs.readFile(path.resolve(__dirname, '../src/core', name), 'utf8');
    assert.doesNotMatch(text, /require\(['"](?:electron|.*\/main\/|.*\/cli\/)/);
    assert.doesNotMatch(text, /process\.(?:argv|send)|require\.main/);
  }
});

test('CLI library rename takes a backup and invalid libraries are never partly loaded', async t => {
  const f = await fixture(t);
  assert.equal((await f.run(['library', 'rename', '--name', '我的图库'])).code, 0);
  assert.equal((await core.readLibraryManifest(f.paths)).name, '我的图库');
  await fs.appendFile(f.paths.metadataFile, '{invalid}\n');
  const result = await f.run(['media', 'list']); assert.equal(result.code, 1); assert.equal(result.out, '');
  await assert.rejects(fs.access(f.paths.lockFile));
});
