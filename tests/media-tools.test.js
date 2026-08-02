const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  parseProbeJson,
  calculateVideoThumbnailTime,
  failedVideoMetadata,
  normalizeMediaConfig,
  resolveMediaToolPaths,
  runMediaTool,
  sanitizeMediaError,
} = require("../scripts/media-tools");
const { defaultCustomization, timeInfoFromDate } = require("../scripts/common");

test("normalizes the default video/audio streams and display dimensions", () => {
  const parsed = parseProbeJson({
    format: {
      duration: "120.5",
      bit_rate: "9000000",
      format_name: "mov,mp4",
      tags: {
        creation_time: "2026-01-08T03:11:14.000000Z",
        "com.apple.quicktime.location.ISO6709": "+39.9042+116.4074+50.0/",
        "com.apple.quicktime.make": "Example",
        "com.apple.quicktime.model": "Camera X",
      },
    },
    streams: [
      { index: 0, codec_type: "video", codec_name: "hevc", width: 1280, height: 720, disposition: { default: 0 } },
      {
        index: 1,
        codec_type: "video",
        codec_name: "h264",
        profile: "High",
        width: 1920,
        height: 1080,
        sample_aspect_ratio: "1:1",
        avg_frame_rate: "30000/1001",
        pix_fmt: "yuv420p10le",
        bit_rate: "8000000",
        color_space: "bt709",
        color_transfer: "bt709",
        color_primaries: "bt709",
        disposition: { default: 1 },
        side_data_list: [{ rotation: -90 }],
      },
      {
        index: 2,
        codec_type: "audio",
        codec_name: "aac",
        channels: 2,
        sample_rate: "48000",
        bit_rate: "192000",
        disposition: { default: 1 },
      },
    ],
  });

  assert.equal(parsed.video.ProbeStatus, "ok");
  assert.equal(parsed.video.VideoCodec, "h264");
  assert.equal(parsed.video.RotationDegrees, 270);
  assert.equal(parsed.video.DisplayWidth, 1080);
  assert.equal(parsed.video.DisplayHeight, 1920);
  assert.equal(parsed.video.FrameRate, 29.97);
  assert.equal(parsed.video.FrameRateRatio, "30000/1001");
  assert.equal(parsed.video.BitDepth, 10);
  assert.equal(parsed.video.VideoStreamCount, 2);
  assert.equal(parsed.video.AudioStreamCount, 1);
  assert.equal(parsed.video.AudioCodec, "aac");
  assert.deepEqual(parsed.creationTimes, [
    { source: "format", value: "2026-01-08T03:11:14.000000Z" },
  ]);
  assert.deepEqual(parsed.camera, { make: "Example", model: "Camera X" });
  assert.deepEqual(parsed.location, { latitude: 39.9042, longitude: 116.4074, altitude: 50 });
});

test("marks containers without video streams as audio-only", () => {
  const parsed = parseProbeJson({
    format: { duration: "3.2", format_name: "mov" },
    streams: [{ codec_type: "audio", codec_name: "aac", channels: 1 }],
  });
  assert.equal(parsed.video.ProbeStatus, "audio-only");
  assert.equal(parsed.video.VideoStreamCount, 0);
  assert.equal(parsed.video.HasAudio, true);
  assert.equal(parsed.video.RotationDegrees, null);
  assert.equal(parsed.video.BitRate, null);
});

test("keeps distinct QuickTime and stream creation-time candidates", () => {
  const parsed = parseProbeJson({
    format: {
      tags: {
        creation_time: "2025-08-02T18:43:25Z",
        "com.apple.quicktime.creationdate": "2025-08-02T11:43:25-07:00",
      },
    },
    streams: [{
      codec_type: "video",
      tags: { creation_time: "2025-08-02T18:43:26Z" },
    }],
  });
  assert.deepEqual(parsed.creationTimes, [
    { source: "quicktime", value: "2025-08-02T11:43:25-07:00" },
    { source: "format", value: "2025-08-02T18:43:25Z" },
    { source: "video", value: "2025-08-02T18:43:26Z" },
  ]);
});

test("calculates bounded video thumbnail seek times", () => {
  assert.equal(calculateVideoThumbnailTime(null), 0);
  assert.equal(calculateVideoThumbnailTime(0.5), 0.25);
  assert.equal(calculateVideoThumbnailTime(20), 2);
  assert.equal(calculateVideoThumbnailTime(2000), 10);
});

test("failed metadata has a stable complete shape", () => {
  const result = failedVideoMetadata(new Error("broken input"), "C:\\media\\bad.mp4");
  assert.equal(result.ProbeStatus, "failed");
  assert.match(result.ProbeError, /broken input/);
  assert.equal(result.VideoStreamCount, 0);
  assert.equal(result.HasAudio, false);
  assert.equal(result.RotationDegrees, null);
});

test("keeps absent numeric fields null and preserves media rating defaults", () => {
  const parsed = parseProbeJson({
    format: { duration: null },
    streams: [{ codec_type: "video", width: null, height: "", avg_frame_rate: "0/0" }],
  });
  assert.equal(parsed.video.DurationSeconds, null);
  assert.equal(parsed.video.Width, null);
  assert.equal(parsed.video.Height, null);
  assert.equal(parsed.video.FrameRate, null);
  assert.equal(defaultCustomization(".mp4").Rating, 2);
  assert.equal(defaultCustomization(".jpg").Rating, 2);
  assert.equal(defaultCustomization(".png").Rating, 1);
  assert.equal(defaultCustomization(".mp4").Privacy, 1);
  assert.equal(defaultCustomization(".jpg").Privacy, 1);
});

test("normalizes raw filesystem dates to UTC before a media timezone is known", () => {
  assert.deepEqual(timeInfoFromDate(new Date("2025-08-27T23:14:44Z")), {
    text: "2025-08-27 23:14:44",
    zone: 0,
    stamp: Date.UTC(2025, 7, 27, 23, 14, 44) / 1000,
  });
});

test("resolves relative and absolute FFmpeg directories", () => {
  const appRoot = path.resolve("C:\\photo-manager");
  const relative = resolveMediaToolPaths(appRoot, { ffmpegDir: "tools/ffmpeg/bin" });
  assert.equal(relative.ffmpegPath, path.join(appRoot, "tools/ffmpeg/bin", "ffmpeg.exe"));
  const absoluteDir = path.resolve("C:\\media-tools");
  const absolute = resolveMediaToolPaths(appRoot, { ffmpegDir: absoluteDir });
  assert.equal(absolute.ffprobePath, path.join(absoluteDir, "ffprobe.exe"));
});

test("invalid media configuration values fall back to bounded defaults", () => {
  const config = normalizeMediaConfig({
    probeTimeoutSeconds: "invalid",
    thumbnailTimeoutSeconds: 0,
    videoThumbnailConcurrency: 2.9,
  });
  assert.equal(config.probeTimeoutSeconds, 30);
  assert.equal(config.thumbnailTimeoutSeconds, 1);
  assert.equal(config.videoThumbnailConcurrency, 2);
});

test("media tool execution enforces timeouts and sanitizes source paths", { timeout: 5000 }, async () => {
  await assert.rejects(
    runMediaTool(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { timeoutMs: 1000 }),
  );
  const sourcePath = "C:\\Users\\Example User\\Videos\\broken.mp4";
  const message = sanitizeMediaError(new Error(`Cannot read ${sourcePath}`), sourcePath);
  assert.equal(message.includes(sourcePath), false);
  assert.match(message, /broken\.mp4/);
});
