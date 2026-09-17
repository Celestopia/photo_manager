/* Run under the packaged Electron executable with ELECTRON_RUN_AS_NODE=1. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const resources = path.resolve("release/win-unpacked/resources");
const code = path.join(resources, "app.asar");
const inputs = require(path.join(code, "src/main/chat/inputs.js"));
const { resolveMediaToolPaths, runMediaTool } = require(
  path.join(code, "scripts/media-tools.js"),
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
    const paths = require(path.join(code, 'scripts/library-core.js')).resolveLibraryPaths(root);
    await fs.mkdir(paths.managerDir);
    const cover = await require(path.join(code, 'scripts/video-cover-cache.js')).generateCover({
      paths, source: video, hash: 'a'.repeat(64), appRoot: resources, config: {}, beforePublish: async () => {},
    });
    assert.ok(cover.length > 0);
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
