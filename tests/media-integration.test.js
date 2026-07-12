const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { APP_ROOT, buildMetadata } = require("../scripts/common");
const {
  resolveMediaToolPaths,
  runMediaTool,
  validateMediaTools,
} = require("../scripts/media-tools");
const {
  normalizeThumbnailConfig,
  thumbnailAbsolutePath,
  ensureThumbnailForItem,
} = require("../scripts/thumbnail-cache");

const mediaConfig = {
  ffmpegDir: "./tools/ffmpeg/bin",
  probeTimeoutSeconds: 30,
  thumbnailTimeoutSeconds: 60,
  videoThumbnailConcurrency: 1,
};

test("bundled FFmpeg probes a generated MP4 and creates a WebP thumbnail", { timeout: 90000 }, async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "photo-manager-media-test-"));
  try {
    const videoPath = path.join(tempRoot, "sample.mp4");
    const cacheDir = path.join(tempRoot, "thumbs");
    const tools = await validateMediaTools(APP_ROOT, mediaConfig);
    const paths = resolveMediaToolPaths(APP_ROOT, mediaConfig);
    await runMediaTool(paths.ffmpegPath, [
      "-hide_banner",
      "-loglevel", "error",
      "-f", "lavfi",
      "-i", "color=c=0x35699a:s=320x180:r=30",
      "-f", "lavfi",
      "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "1.2",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-shortest",
      "-y",
      videoPath,
    ], { timeoutMs: 60000 });

    const item = await buildMetadata(videoPath, tempRoot, { mediaConfig });
    assert.match(tools.versions.ffmpeg, /8\.1\.2/);
    assert.equal(item.FileSystem.FileType, "video");
    assert.equal(item.Customization.Rating, 2);
    assert.equal(item.Video.ProbeStatus, "ok");
    assert.equal(item.Video.VideoCodec, "h264");
    assert.equal(item.Video.AudioCodec, "aac");
    assert.equal(item.Video.DisplayWidth, 320);
    assert.equal(item.Video.DisplayHeight, 180);

    const generated = await ensureThumbnailForItem(item, {
      workspaceRoot: tempRoot,
      cacheDir,
      options: normalizeThumbnailConfig({ size: 160 }),
      mediaConfig,
    });
    assert.equal(generated, true);
    const thumbnailStat = await fsp.stat(thumbnailAbsolutePath(cacheDir, item.SHA256Hash));
    assert.ok(thumbnailStat.size > 0);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});

test("a damaged video still produces an editable failed-probe metadata record", { timeout: 10000 }, async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "photo-manager-damaged-video-test-"));
  try {
    const videoPath = path.join(tempRoot, "damaged.mp4");
    await fsp.writeFile(videoPath, "not a valid media container");
    const modified = new Date("2026-02-03T04:05:06Z");
    await fsp.utimes(videoPath, modified, modified);
    const item = await buildMetadata(videoPath, tempRoot, { mediaConfig });
    assert.equal(item.FileSystem.FileType, "video");
    assert.equal(item.Video.ProbeStatus, "failed");
    assert.equal(item.Video.DurationSeconds, null);
    assert.equal(item.Customization.Rating, 2);
    assert.equal(item.FileSystem.ShootingTimeStamp, Math.floor(modified.getTime() / 1000));
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});
