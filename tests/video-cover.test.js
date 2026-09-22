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

    }
  }
});
test("pruning preserves covers while any duplicate hash remains", async t => {
  const paths = await fixture(t);
  await fs.mkdir(paths.videoCoverDir);
  await fs.writeFile(path.join(paths.videoCoverDir, coverName(hash)), 'cover');
  const item = {MediaId: 'one', SHA256Hash: hash, FileSystem: { FileType: 'video' }};
  await pruneVideoCovers(paths, [item, {...item, MediaId: 'two'}]);
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
