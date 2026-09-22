const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { fileURLToPath } = require('node:url');
const { resolveLibraryPaths } = require('../scripts/library-core');
const { coverName } = require('../scripts/video-cover-cache');
const { createViewerImageResources, handleViewerImageRequest } = require('../src/main/viewer-image-resources');

test('viewer resources stream photos and covers without decoding and revoke stale URLs', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-viewer-resource-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const paths = resolveLibraryPaths(root);
  await fs.mkdir(paths.videoCoverDir, { recursive: true });
  await fs.writeFile(path.join(root, 'source'), 'source bytes');
  const stat = await fs.stat(path.join(root, 'source'));
  const item = { MediaId: 'one', FilePath: 'source', SHA256Hash: 'a'.repeat(64), FileSystem: {
    FileType: 'video', FileSize: stat.size, ModificationTimeMs: stat.mtimeMs } };
  // Deliberately not a decodable image: serving must leave decoding to Chromium.
  await fs.writeFile(path.join(paths.videoCoverDir, coverName(item.SHA256Hash)), 'cover bytes');
  const library = { paths, state: 'open', sessionId: 'session' };
  const resources = createViewerImageResources({ getLibrary: () => library, getItem: id => id === 'one' ? item : null,
    fetchFile: async url => new Response(await fs.readFile(fileURLToPath(url))) });
  t.after(() => resources.invalidate());
  const url = resources.urlFor(item);
  assert.equal(resources.urlFor(item), url, 'URL is stable for an unchanged resource');
  assert.equal(await (await handleViewerImageRequest(new Request(url))).text(), 'cover bytes');
  resources.invalidate();
  const revised = resources.urlFor(item);
  assert.notEqual(revised, url);
  assert.equal((await handleViewerImageRequest(new Request(url))).status, 404);
  item.FileSystem.FileType = 'image';
  assert.equal(await (await handleViewerImageRequest(new Request(revised))).text(), 'source bytes');
  await fs.appendFile(path.join(root, 'source'), 'changed');
  assert.equal((await handleViewerImageRequest(new Request(revised))).status, 404);
  resources.invalidate();
  assert.equal((await handleViewerImageRequest(new Request(revised))).status, 404);
  assert.equal((await handleViewerImageRequest(new Request('viewer-image://unknown/../../outside'))).status, 404);
});
