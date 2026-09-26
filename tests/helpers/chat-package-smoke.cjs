/* Run under the packaged Electron executable with ELECTRON_RUN_AS_NODE=1. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const resources = path.resolve("release/gui-win-x64-unpacked/resources");
// Match the resource-root environment passed to packaged maintenance workers.
process.env.PHOTO_MANAGER_RESOURCE_ROOT = resources;
const code = path.join(resources, "app.asar");
const inputs = require(path.join(code, "src/main/chat/inputs.js"));
const { resolveMediaToolPaths, runMediaTool } = require(
  path.join(code, "src/core/media-tools.js"),
);
const tools = resolveMediaToolPaths(resources, {});
async function run() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "photo-manager-chat-package-"),
  );
  try {
    const video = path.join(root, "video.mp4");
    await runMediaTool(tools.ffmpegPath, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=32x32:r=10",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-y",
      video,
    ]);
    const info = await inputs.inspect(video, { video: true, tools });
    const paths = require(path.join(code, 'src/core/library-core.js')).resolveLibraryPaths(root);
    await fs.mkdir(paths.managerDir);
    const cover = await require(path.join(code, 'src/core/video-cover-cache.js')).generateCover({
      paths, source: video, hash: 'a'.repeat(64), appRoot: resources, config: {}, beforePublish: async () => {},
    });
    assert.ok(cover.length > 0);
    const { createViewerImageResources, handleViewerImageRequest } = require(path.join(code, 'src/main/viewer-image-resources.js'));
    const sourceStat = await fs.stat(video);
    const resourceItem = { MediaId: 'fixture', FilePath: 'video.mp4', SHA256Hash: 'a'.repeat(64), FileSystem: {
      FileType: 'video', FileSize: sourceStat.size, ModificationTimeMs: sourceStat.mtimeMs } };
    const libraryState = { paths, sessionId: 'fixture', state: 'open' };
    const resourcesService = createViewerImageResources({ getLibrary: () => libraryState, getItem: () => resourceItem,
      fetchFile: async url => new Response(await fs.readFile(require('node:url').fileURLToPath(url))) });
    const imageResponse = await handleViewerImageRequest(new Request(resourcesService.urlFor(resourceItem)));
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), cover);
    resourcesService.invalidate();
    const videoStat = await fs.stat(video);
    const batchStats = await require(path.join(code, 'src/core/build-video-covers.js')).ensureVideoCovers([
      { FilePath: 'video.mp4', SHA256Hash: 'a'.repeat(64), FileSystem: {
        FileType: 'video', FileSize: videoStat.size, ModificationTimeMs: videoStat.mtimeMs } },
    ], { paths, config: {}, force: true });
    assert.equal(batchStats.generated, 1);
    const thumbnailPath = path.join(root, 'thumbnail.webp');
    await require(path.join(code, 'src/core/thumbnail-cache.js')).generateVideoThumbnail({}, video, thumbnailPath,
      { size: 32, webpQuality: 80, extremeAspectRatio: 4 }, {});
    assert.ok((await fs.stat(thumbnailPath)).size > 0);
    const frames = await inputs.prepare(video, info, "sampled", 3, { tools });
    assert.equal(frames.length, 3);
    assert.ok(frames.every((f) => f.mime === "image/jpeg" && f.width === 32));
    const image = path.join(root, "image.jpg");
    await fs.writeFile(image, frames[0].bytes);
    const imageInfo = await inputs.inspect(image);
    const [original] = await inputs.prepare(image, imageInfo, "original", 1, {
      tools,
    });
    assert.deepEqual(original.bytes, frames[0].bytes);
    assert.equal(require(path.join(code, 'package.json')).version, require('../../package.json').version);
    const { tools: agentTools } = require(path.join(code, 'src/main/chat/tools'));
    const scope = { mediaIds: [], groups: { basic: false }, webEnabled: true };
    assert.deepEqual(agentTools.available(scope).map(t => t.name), ['web_search', 'read_web_page']);
    const search = require(path.join(code, 'src/main/chat/search-provider'));
    const found = await search.adapter({ apiKey: 'fixture' }, async () => new Response(JSON.stringify({ results: [{ title: 'Tower', url: 'https://www.toureiffel.paris/en', content: 'Paris' }] }))).search({ query: 'Tower' });
    assert.equal(found.sources.length, 1);
    console.log(
      "CHAT_PACKAGE_SMOKE_PASS: current-version ASAR, web tools/adapter, Sharp, bundled FFmpeg and original bytes.",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
