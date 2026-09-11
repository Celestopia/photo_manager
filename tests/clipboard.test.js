const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function handlers(copyFile, resolvePath) {
  const registered = new Map();
  const electron = { clipboard: {}, ipcMain: { handle: (name, handler) => registered.set(name, handler) } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main/ipc-handlers.js'), 'utf8'), {
    module, exports: module.exports,
    require: name => name === 'electron' ? electron : name === './file-clipboard' ? { copyFileToClipboard: copyFile } : require(name),
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
