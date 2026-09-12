const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const identitySchema = require('../src/shared/identity-schema.js');
const objectSchema = require('../src/shared/object-schema.js');
function handlers(copyFile, resolvePath, copyFiles = async () => {}) {
  const registered = new Map();
  const electron = { clipboard: {}, ipcMain: { handle: (name, handler) => registered.set(name, handler) } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main/ipc-handlers.js'), 'utf8'), {
    module, exports: module.exports,
    require: name => {
      if (name === 'electron') return electron;
      if (name === './file-clipboard') return { copyFileToClipboard: copyFile, copyFilesToClipboard: copyFiles };
      if (name === '../shared/identity-schema.js') return identitySchema;
      if (name === '../shared/object-schema.js') return objectSchema;
      return require(name);
    },
  });
  module.exports.registerIpcHandlers({ services: {}, runtime: {}, resolveIndexedMediaPath: resolvePath });
  return registered;
}
test('Copy File supports photos and videos, preserves Unicode paths and waits for completion', async () => {
  for (const extension of ['jpg', 'mp4']) {
    const source = `G:\\照片 library\\a $test.${extension}`;
    let finish, copied, completed = false;
    const registered = handlers(file => { copied = file; return new Promise(resolve => { finish = resolve; }); }, () => ({ absolutePath: source }));
    assert.equal(registered.has('photo:copy-image'), false);
    const pending = registered.get('photo:copy-file')({}, 'media-id').then(result => { completed = true; return result; });
    await Promise.resolve();
    assert.equal(completed, false);
    assert.equal(copied, source);
    finish();
    assert.equal((await pending).ok, true);
  }
});
test('Copy File reports invalid source and clipboard failures', async () => {
  const invalid = handlers(() => assert.fail('must not write'), () => { throw new Error('Media file not found'); });
  assert.equal((await invalid.get('photo:copy-file')({}, 'id')).error, 'Media file not found');
  const failed = handlers(async () => { throw new Error('Clipboard busy'); }, () => ({ absolutePath: 'x.mp4' }));
  assert.equal((await failed.get('photo:copy-file')({}, 'id')).error, 'Clipboard busy');
});

test('Batch Copy publishes one ordered Unicode file list and waits for completion', async () => {
  const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
  const sources = new Map([[ids[0], 'G:\\照片 library\\a.jpg'], [ids[1], 'G:\\照片 library\\b.mp4']]);
  let finish, copied, completed = false;
  const registered = handlers(
    () => assert.fail('single-file helper must not run'),
    mediaId => ({ absolutePath: sources.get(mediaId) }),
    files => { copied = files; return new Promise(resolve => { finish = resolve; }); },
  );
  const pending = registered.get('photo:copy-files')({}, { mediaIds: ids }).then(result => { completed = true; return result; });
  await Promise.resolve();
  assert.equal(completed, false);
  assert.deepEqual(copied, [...sources.values()]);
  finish();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.copiedCount, 2);
});

test('Batch Copy validates every source before replacing the clipboard', async () => {
  const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
  let clipboardWrites = 0;
  const registered = handlers(
    () => {},
    mediaId => {
      if (mediaId === ids[1]) throw new Error('Media file not found');
      return { absolutePath: 'G:\\library\\a.jpg' };
    },
    async () => { clipboardWrites += 1; },
  );
  const result = await registered.get('photo:copy-files')({}, { mediaIds: ids });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Media file not found');
  assert.equal(clipboardWrites, 0);
});
