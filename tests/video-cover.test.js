const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const sharp = require("sharp");
const { resolveLibraryPaths } = require("../scripts/library-core");
const { resolveMediaToolPaths, runMediaTool } = require("../scripts/media-tools");
const { generateCover, coverName, pruneVideoCovers } = require("../scripts/video-cover-cache");
const { runCoverTool } = require("../scripts/video-first-frame");
const { createVideoCoverService } = require("../src/main/video-cover-service");
const appRoot = path.resolve(__dirname, "..");
const hash = "a".repeat(64);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pm-cover-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const paths = resolveLibraryPaths(root);
  await fs.mkdir(paths.managerDir);
  return paths;
}
test("real first-frame covers preserve size, SAR, rotation and black openings", async t => {
  const paths = await fixture(t);
  const tools = resolveMediaToolPaths(appRoot, {});
  for (const [name, size, filter, expected] of [
    ["landscape", "320x180", "null", [320, 180]],
    ["portrait", "180x320", "null", [180, 320]],
    ["sar", "320x180", "setsar=2", [640, 180]],
    ["large", "3000x1800", "null", [2560, 1536]],
    ["black", "320x180", "drawbox=color=red:t=fill:enable='gte(t,0.1)'", [320, 180]],
    ["rotation", "320x180", "null", [180, 320]],
  ]) {
    const source = path.join(paths.root, `${name}.mp4`);
    await runMediaTool(tools.ffmpegPath, ["-v", "error", "-f", "lavfi", "-i", `color=black:s=${size}:r=10`,
      "-vf", filter, "-t", "0.3", "-c:v", "libx264", "-threads", "1", "-y", source]);
    if (name === "rotation") {
      const rotated = path.join(paths.root, "rotated.mp4");
      await runMediaTool(tools.ffmpegPath, ["-v", "error", "-display_rotation", "90", "-i", source, "-c", "copy", "-y", rotated]);
      await fs.rename(rotated, source);
    }
    const bytes = await generateCover({ paths, source, hash, appRoot, config: {}, beforePublish: async () => {} });
    const metadata = await sharp(bytes).metadata();
    assert.deepEqual([metadata.width, metadata.height], expected, name);
    if (name === "black") {
      const stats = await sharp(bytes).stats();
      assert.ok(stats.channels.slice(0, 3).every(channel => channel.mean < 3));
      const thumbnail = path.join(paths.root, "first-frame-thumbnail.webp");
      await require("../scripts/thumbnail-cache").generateVideoThumbnail(
        { Video: { DurationSeconds: 20 } }, source, thumbnail,
        { size: 160, webpQuality: 80, extremeAspectRatio: 4 }, {});
      const thumbBytes = await fs.readFile(thumbnail);
      const thumbInfo = await sharp(thumbBytes).metadata();
      assert.deepEqual([thumbInfo.width, thumbInfo.height], [160, 160]);
      assert.ok((await sharp(thumbBytes).stats()).channels.slice(0, 3).every(channel => channel.mean < 3));
    }
    if (name === "landscape") {
      await assert.rejects(generateCover({ paths, source, hash, appRoot, config: {},
        beforePublish: async () => { throw new Error("source changed"); } }), /source changed/);
      assert.ok((await fs.readdir(paths.videoCoverDir)).every(name => !name.includes('.tmp.')));
      const stat = await fs.stat(source);
      const item = { SHA256Hash: hash, FileSystem: { FileType: 'video', FileSize: stat.size, ModificationTimeMs: stat.mtimeMs } };
      const service = createVideoCoverService({ getLibrary: () => ({ paths, sessionId: 'fixture' }),
        resolveMedia: () => ({ item, absolutePath: source }), appRoot, getConfig: () => ({}), resourceChanged: () => "viewer-image://fixture/cover", log: () => {} });
      await fs.writeFile(path.join(paths.videoCoverDir, coverName(hash)), 'corrupt');
      assert.equal((await service.request({ requestId: 'repair', mediaId: 'fixture' })).status, 'ready');
      await service.stop();
      const before = (await fs.stat(path.join(paths.videoCoverDir, coverName(hash)))).mtimeMs;
      assert.equal((await service.request({ requestId: 'reuse', mediaId: 'fixture' })).status, 'ready');
      assert.ok((await fs.stat(path.join(paths.videoCoverDir, coverName(hash)))).mtimeMs >= before);
      await service.stop();
    }
  }
});
test("service shares covers, validates sources, cancels and prunes without losing duplicate hashes", async t => {
  const paths = await fixture(t);
  const source = path.join(paths.root, "video.mp4");
  await fs.writeFile(source, "fixture");
  const stat = await fs.stat(source);
  const item = { MediaId: "one", SHA256Hash: hash, FileSystem: { FileType: "video", FileSize: stat.size, ModificationTimeMs: stat.mtimeMs } };
  let calls = 0;
  const bytes = await sharp({ create: { width: 32, height: 18, channels: 3, background: "black" } }).webp().toBuffer();
  const service = createVideoCoverService({ getLibrary: () => ({ paths, sessionId: "session", manifest: { libraryId: "library" } }),
    resolveMedia: () => ({ item, absolutePath: source }), appRoot, getConfig: () => ({}), resourceChanged: () => "viewer-image://fixture/cover", log: () => {},
    generate: async ({ signal }) => { calls++; await new Promise(resolve => setTimeout(resolve, 20)); signal.throwIfAborted(); return bytes; } });
  const results = await Promise.all([service.request({ requestId: "a", mediaId: "one" }), service.request({ requestId: "b", mediaId: "one" })]);
  assert.ok(results.every(result => result.status === "ready"));
  assert.equal(calls, 1);
  await service.stop();
  const pending = service.request({ requestId: "c", mediaId: "one" });
  await service.stop();
  assert.equal((await pending).status, "cancelled");
  await fs.appendFile(source, "changed");
  assert.equal((await service.request({ requestId: "d", mediaId: "one" })).status, "source-changed");
  await service.stop();
  await fs.mkdir(paths.videoCoverDir);
  await fs.writeFile(path.join(paths.videoCoverDir, coverName(hash)), bytes);
  await pruneVideoCovers(paths, [item, { ...item, MediaId: "two" }]);
  assert.equal((await fs.readdir(paths.videoCoverDir)).length, 1);
  await pruneVideoCovers(paths, []);
  assert.equal((await fs.readdir(paths.videoCoverDir)).length, 0);
});
test("tool cancellation waits for process exit and reports AbortError", async () => {
  const controller = new AbortController();
  const promise = runCoverTool(process.execPath, ["-e", "setTimeout(()=>{},30000)"], { signal: controller.signal, timeoutMs: 60000 });
  controller.abort();
  await assert.rejects(promise, { name: "AbortError" });
});
