const { execFile } = require("node:child_process");
const path = require("node:path");

const DEFAULT_MEDIA_CONFIG = Object.freeze({
  ffmpegDir: "./tools/ffmpeg/bin",
  probeTimeoutSeconds: 30,
  thumbnailTimeoutSeconds: 60,
  videoThumbnailConcurrency: 1,
});

function normalizedNumber(value, fallback, minimum, { integer = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const bounded = Math.max(minimum, parsed);
  return integer ? Math.floor(bounded) : bounded;
}

function normalizeMediaConfig(rawConfig) {
  const raw = rawConfig || {};
  return {
    ...DEFAULT_MEDIA_CONFIG,
    ...raw,
    ffmpegDir: String(raw.ffmpegDir || DEFAULT_MEDIA_CONFIG.ffmpegDir),
    probeTimeoutSeconds: normalizedNumber(raw.probeTimeoutSeconds, DEFAULT_MEDIA_CONFIG.probeTimeoutSeconds, 1),
    thumbnailTimeoutSeconds: normalizedNumber(raw.thumbnailTimeoutSeconds, DEFAULT_MEDIA_CONFIG.thumbnailTimeoutSeconds, 1),
    videoThumbnailConcurrency: normalizedNumber(
      raw.videoThumbnailConcurrency,
      DEFAULT_MEDIA_CONFIG.videoThumbnailConcurrency,
      1,
      { integer: true },
    ),
  };
}

function resolveMediaToolPaths(appRoot, rawConfig) {
  const config = normalizeMediaConfig(rawConfig);
  const dir = path.isAbsolute(config.ffmpegDir) ? config.ffmpegDir : path.resolve(appRoot, config.ffmpegDir);
  return {
    config,
    dir,
    ffmpegPath: path.join(dir, "ffmpeg.exe"),
    ffprobePath: path.join(dir, "ffprobe.exe"),
  };
}

function sanitizeMediaError(error, sourcePath = "") {
  const raw = String(error?.stderr || error?.message || error || "Unknown media error")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let withoutPath = raw;
  if (sourcePath) {
    const basename = path.basename(sourcePath);
    const pathVariants = new Set([
      String(sourcePath),
      String(sourcePath).replace(/\\/g, "/"),
      String(sourcePath).replace(/\//g, "\\"),
    ]);
    for (const candidate of pathVariants) withoutPath = withoutPath.split(candidate).join(basename);
  }
  return withoutPath.slice(0, 240) || "Unknown media error";
}

function runMediaTool(executable, args, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 30000));
  const maxBuffer = Math.max(1024 * 1024, Number(options.maxBuffer || 8 * 1024 * 1024));
  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer,
      encoding: "utf8",
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function validateMediaTools(appRoot, rawConfig, options = {}) {
  const paths = resolveMediaToolPaths(appRoot, rawConfig);
  const requireFfmpeg = options.requireFfmpeg !== false;
  const requireFfprobe = options.requireFfprobe !== false;
  const timeoutMs = Math.min(10000, paths.config.probeTimeoutSeconds * 1000);
  const versions = {};

  if (requireFfmpeg) {
    const result = await runMediaTool(paths.ffmpegPath, ["-version"], { timeoutMs });
    versions.ffmpeg = String(result.stdout || "").split(/\r?\n/)[0] || "ffmpeg";
  }
  if (requireFfprobe) {
    const result = await runMediaTool(paths.ffprobePath, ["-version"], { timeoutMs });
    versions.ffprobe = String(result.stdout || "").split(/\r?\n/)[0] || "ffprobe";
  }

  return { ...paths, versions };
}

function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumberOrNull(value) {
  const number = numberOrNull(value);
  return number !== null && number >= 0 ? number : null;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number);
}

function positiveIntegerOrNull(value) {
  const number = integerOrNull(value);
  return number !== null && number > 0 ? number : null;
}

function parseRatio(value, separatorPattern = /[:/]/) {
  const raw = String(value || "").trim();
  const parts = raw.split(separatorPattern).map(Number);
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1]) || parts[1] === 0) return null;
  return parts[0] / parts[1];
}

function normalizeFrameRate(stream) {
  const candidate = String(stream?.avg_frame_rate || "").trim();
  const parsed = parseRatio(candidate, /\//);
  const ratioText = candidate && candidate !== "0/0" && parsed !== null && parsed > 0
    ? candidate
    : null;
  const ratio = parseRatio(ratioText, /\//);
  return {
    value: ratio === null ? null : Number(ratio.toFixed(3)),
    ratio: ratioText,
  };
}

function normalizeRotation(stream) {
  if (!stream) return null;
  const sideData = Array.isArray(stream?.side_data_list) ? stream.side_data_list : [];
  const sideRotation = sideData.map((item) => numberOrNull(item?.rotation)).find((value) => value !== null);
  const tagRotation = numberOrNull(stream?.tags?.rotate);
  const raw = sideRotation ?? tagRotation ?? 0;
  return ((Math.round(raw) % 360) + 360) % 360;
}

function inferBitDepth(stream) {
  const explicit = integerOrNull(stream?.bits_per_raw_sample);
  if (explicit && explicit > 0) return explicit;
  const pixelFormat = String(stream?.pix_fmt || "").toLowerCase();
  const match = pixelFormat.match(/p0?(8|9|10|12|14|16)(?:le|be)?$/);
  if (match) return Number(match[1]);
  if (/^(?:yuv|yuva|nv|rgb|bgr|gbr)/.test(pixelFormat)) return 8;
  return null;
}

function selectDefaultStream(streams, type) {
  const matches = streams.filter((stream) => stream?.codec_type === type);
  return matches.find((stream) => Number(stream?.disposition?.default || 0) === 1) || matches[0] || null;
}

function normalizeTags(tags) {
  const output = new Map();
  for (const [key, value] of Object.entries(tags || {})) {
    output.set(String(key).toLowerCase(), value);
  }
  return output;
}

function firstTag(tagMaps, keys) {
  for (const tags of tagMaps) {
    for (const key of keys) {
      const value = tags.get(key.toLowerCase());
      if (value !== undefined && String(value).trim()) return String(value).trim();
    }
  }
  return null;
}

function parseIso6709(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?\/?$/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  const altitude = match[3] === undefined ? null : Number(match[3]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude, altitude: Number.isFinite(altitude) ? altitude : null };
}

function calculateDisplayDimensions(width, height, sampleAspectRatio, rotation) {
  if (!width || !height) return { width: null, height: null };
  const sampleRatio = parseRatio(sampleAspectRatio, /:/) || 1;
  let displayWidth = Math.max(1, Math.round(width * sampleRatio));
  let displayHeight = Math.max(1, Math.round(height));
  if (rotation === 90 || rotation === 270) {
    [displayWidth, displayHeight] = [displayHeight, displayWidth];
  }
  return { width: displayWidth, height: displayHeight };
}

function parseProbeJson(probe) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const format = probe?.format && typeof probe.format === "object" ? probe.format : {};
  const videoStreams = streams.filter((stream) => stream?.codec_type === "video");
  const audioStreams = streams.filter((stream) => stream?.codec_type === "audio");
  const videoStream = selectDefaultStream(streams, "video");
  const audioStream = selectDefaultStream(streams, "audio");
  const formatTags = normalizeTags(format.tags);
  const videoTags = normalizeTags(videoStream?.tags);
  const audioTags = normalizeTags(audioStream?.tags);
  const allTags = [formatTags, videoTags, audioTags];
  const frameRate = normalizeFrameRate(videoStream);
  const rotation = normalizeRotation(videoStream);
  const width = positiveIntegerOrNull(videoStream?.width);
  const height = positiveIntegerOrNull(videoStream?.height);
  const rawSampleAspectRatio = String(videoStream?.sample_aspect_ratio || "").trim();
  const parsedSampleAspectRatio = parseRatio(rawSampleAspectRatio, /:/);
  const sampleAspectRatio = parsedSampleAspectRatio !== null && parsedSampleAspectRatio > 0
    ? rawSampleAspectRatio
    : null;
  const display = calculateDisplayDimensions(width, height, sampleAspectRatio, rotation);
  const duration = positiveNumberOrNull(format.duration)
    ?? positiveNumberOrNull(videoStream?.duration)
    ?? positiveNumberOrNull(audioStream?.duration);
  const locationText = firstTag(allTags, [
    "com.apple.quicktime.location.iso6709",
    "location",
    "location-eng",
  ]);
  const creationTime = firstTag([formatTags], ["creation_time"])
    || firstTag([videoTags], ["creation_time"])
    || firstTag(allTags, ["com.apple.quicktime.creationdate"]);
  const cameraMake = firstTag(allTags, [
    "com.apple.quicktime.make",
    "make",
    "manufacturer",
    "com.android.manufacturer",
  ]);
  const cameraModel = firstTag(allTags, [
    "com.apple.quicktime.model",
    "model",
    "com.android.model",
  ]);
  const probeStatus = videoStream ? "ok" : audioStream ? "audio-only" : "failed";

  return {
    video: {
      ProbeStatus: probeStatus,
      ProbeError: probeStatus === "failed" ? "No video or audio stream found" : null,
      DurationSeconds: duration === null ? null : Number(duration.toFixed(3)),
      Width: width,
      Height: height,
      DisplayWidth: display.width,
      DisplayHeight: display.height,
      RotationDegrees: rotation,
      SampleAspectRatio: sampleAspectRatio,
      FrameRate: frameRate.value,
      FrameRateRatio: frameRate.ratio,
      VideoCodec: videoStream?.codec_name || null,
      VideoProfile: videoStream?.profile || null,
      PixelFormat: videoStream?.pix_fmt || null,
      BitDepth: videoStream ? inferBitDepth(videoStream) : null,
      BitRate: videoStream ? (positiveIntegerOrNull(videoStream.bit_rate) ?? positiveIntegerOrNull(format.bit_rate)) : null,
      ContainerFormat: format.format_name || null,
      VideoStreamCount: videoStreams.length,
      AudioStreamCount: audioStreams.length,
      HasAudio: audioStreams.length > 0,
      AudioCodec: audioStream?.codec_name || null,
      AudioChannels: positiveIntegerOrNull(audioStream?.channels),
      AudioSampleRate: positiveIntegerOrNull(audioStream?.sample_rate),
      AudioBitRate: positiveIntegerOrNull(audioStream?.bit_rate),
      ColorSpace: videoStream?.color_space || null,
      ColorTransfer: videoStream?.color_transfer || null,
      ColorPrimaries: videoStream?.color_primaries || null,
    },
    creationTime,
    camera: { make: cameraMake, model: cameraModel },
    location: parseIso6709(locationText),
  };
}

function failedVideoMetadata(error, sourcePath = "") {
  return {
    ProbeStatus: "failed",
    ProbeError: sanitizeMediaError(error, sourcePath),
    DurationSeconds: null,
    Width: null,
    Height: null,
    DisplayWidth: null,
    DisplayHeight: null,
    RotationDegrees: null,
    SampleAspectRatio: null,
    FrameRate: null,
    FrameRateRatio: null,
    VideoCodec: null,
    VideoProfile: null,
    PixelFormat: null,
    BitDepth: null,
    BitRate: null,
    ContainerFormat: null,
    VideoStreamCount: 0,
    AudioStreamCount: 0,
    HasAudio: false,
    AudioCodec: null,
    AudioChannels: null,
    AudioSampleRate: null,
    AudioBitRate: null,
    ColorSpace: null,
    ColorTransfer: null,
    ColorPrimaries: null,
  };
}

async function probeVideoFile(filePath, appRoot, rawConfig) {
  const paths = resolveMediaToolPaths(appRoot, rawConfig);
  const result = await runMediaTool(paths.ffprobePath, [
    "-hide_banner",
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ], {
    timeoutMs: paths.config.probeTimeoutSeconds * 1000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return parseProbeJson(JSON.parse(result.stdout || "{}"));
}

function calculateVideoThumbnailTime(durationValue) {
  const duration = positiveNumberOrNull(durationValue);
  if (duration === null || duration <= 0) return 0;
  return Math.max(0, Math.min(Math.max(duration * 0.1, 1), 10, duration / 2));
}

async function extractVideoFrame(sourcePath, targetPath, seekSeconds, appRoot, rawConfig) {
  const paths = resolveMediaToolPaths(appRoot, rawConfig);
  const args = ["-hide_banner", "-loglevel", "error"];
  if (Number(seekSeconds) > 0) args.push("-ss", String(Number(seekSeconds).toFixed(3)));
  args.push(
    "-i", sourcePath,
    "-map", "0:v:0",
    "-frames:v", "1",
    "-an",
    "-sn",
    "-y",
    targetPath,
  );
  await runMediaTool(paths.ffmpegPath, args, {
    timeoutMs: paths.config.thumbnailTimeoutSeconds * 1000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

module.exports = {
  DEFAULT_MEDIA_CONFIG,
  normalizeMediaConfig,
  resolveMediaToolPaths,
  sanitizeMediaError,
  runMediaTool,
  validateMediaTools,
  parseProbeJson,
  failedVideoMetadata,
  probeVideoFile,
  calculateVideoThumbnailTime,
  extractVideoFrame,
};
