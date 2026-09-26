/* Run with Node after pack:cli. Test data stay under tmp; no user library is opened. */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const sharp = require('sharp');

async function main() {
  const repo = path.resolve(__dirname, '../..'), base = path.join(repo, 'tmp');
  await fs.mkdir(base, { recursive: true });
  const temp = await fs.mkdtemp(path.join(base, 'cli-package-smoke-'));
  const packageRoot = path.resolve(process.env.CLI_PACKAGE_ROOT || path.join(repo, 'release/cli-win-x64-unpacked'));
  const exe = path.join(packageRoot, 'ptmgr.exe');
  const root = path.join(temp, '图库 with spaces');
  const environment = { ...process.env, APPDATA: path.join(temp, 'roaming'), LOCALAPPDATA: path.join(temp, 'local'),
    PATH: [path.join(process.env.SystemRoot, 'System32'), path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0')].join(';') };
  delete environment.NODE_PATH; delete environment.NODE_OPTIONS; delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.PHOTO_MANAGER_RESOURCE_ROOT; delete environment.PHOTO_MANAGER_LIBRARY_SESSION;
  function command(args, { code = 0, raw = false } = {}) {
    const result = spawnSync(exe, args, { cwd: temp, env: environment, encoding: 'utf8', windowsHide: true, timeout: 120000 });
    if (result.error) throw result.error;
    assert.equal(result.status, code, `${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
    return raw ? result.stdout : JSON.parse(result.stdout);
  }
  const run = (args, options) => command([...args, '--library', root, '--format', 'json'], options);
  try {
    assert.match(command(['--version'], { raw: true }), /0\.41\.0/);
    assert.match(command(['--help'], { raw: true }), /media edit/);
    await assert.rejects(fs.access(environment.APPDATA));
    await fs.mkdir(root);
    await sharp({ create: { width: 64, height: 48, channels: 3, background: 'red' } }).jpeg().toFile(path.join(root, '照片.jpg'));
    const ffmpeg = path.join(packageRoot, 'resources/tools/ffmpeg/bin/ffmpeg.exe');
    const generated = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=10', '-t', '0.3',
      '-c:v', 'libx264', '-y', path.join(root, '视频.mp4')], { encoding: 'utf8', windowsHide: true });
    assert.equal(generated.status, 0, generated.stderr);
    assert.equal(run(['library', 'init', '--name', '测试 Library', '--yes']).total, 2);
    assert.equal(run(['library', 'info']).mediaCount, 2);
    const items = run(['media', 'list']).items;
    const tag = run(['registry', 'tag', 'create', '--name', '旅行']).tag.TagId;
    assert.equal(run(['media', 'edit', '--id', items[0].MediaId, '--title', 'Unicode 中文', '--add-tag', tag]).updatedCount, 1);
    assert.equal(run(['media', 'list', '--tag-name', '旅行']).total, 1);
    assert.equal(run(['maintenance', 'update']).total, 2);
    assert.equal(run(['maintenance', 'verify', '--probe']).tampered, 0);
    assert.equal(run(['maintenance', 'thumbnails']).failed, 0);
    assert.equal(run(['maintenance', 'video-covers']).generated, 1);
    assert.equal(run(['maintenance', 'video-covers']).skipped, 1);
    assert.equal(run(['export', 'csv']).rows, 2);
    assert.equal(run(['registry', 'tag', 'delete', '--id', tag, '--yes']).updatedCount, 1);
    const { resolveLibraryPaths, readLibraryManifest } = require('../../src/core/library-core');
    const { acquireLibraryLock, releaseLibraryLock } = require('../../src/core/library-lock');
    const paths = resolveLibraryPaths(root);
    const lock = await acquireLibraryLock(paths, await readLibraryManifest(paths));
    try { run(['media', 'list'], { code: 3, raw: true }); }
    finally { await releaseLibraryLock(paths, lock.SessionId); }
    await assert.rejects(fs.access(path.join(environment.APPDATA, 'PhotoManager/electron')));
    await assert.rejects(fs.access(path.join(packageRoot, 'resources/app/src/main')));
    console.log('PASS: standalone CLI help, version, initialization, queries, edits, registries, all maintenance, export, and locks; Node absent from PATH.');
  } finally {
    assert.equal(path.dirname(temp), base);
    await fs.rm(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
