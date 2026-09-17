const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const sharp = require("sharp");
const { resolveMediaToolPaths, parseProbeJson } = require("./media-tools.js");

const RECIPE = "v1-2560-q90";
const MAX_PIXELS = 64 * 1024 * 1024;
function coverName(hash) {
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error("Invalid cover hash");
  return `${hash}.${RECIPE}.webp`;
}
async function assertCacheDirectory(paths, create = false) {
  for (const directory of [paths.root, paths.managerDir, paths.videoCoverDir]) {
    let stat = await fs.lstat(directory).catch(error => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (!stat && directory === paths.videoCoverDir && create) {
      await fs.mkdir(directory);
      stat = await fs.lstat(directory);
    }
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw new Error("Unsafe video cover directory");
  }
}
// Settle only after the child exits: lifecycle owners may release locks afterward.
function runCoverTool(executable, args, { signal, timeoutMs }) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let outcome;
    const child = execFile(executable, args, { windowsHide: true, timeout: timeoutMs,
      maxBuffer: 1024 * 1024, encoding: "utf8" }, (error, stdout) => { outcome = { error, stdout }; });
    const abort = () => child.kill();
    signal?.addEventListener("abort", abort, { once: true });
    child.on("close", () => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) reject(new DOMException("Cancelled", "AbortError"));
      else if (outcome?.error) reject(outcome.error);
      else resolve(outcome?.stdout || "");
    });
  });
}
async function readCover(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) throw new Error("Invalid video cover file");
  const bytes = await fs.readFile(file);
  const decoded = await sharp(bytes, { limitInputPixels: 2560 * 2560 }).raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width > 2560 || decoded.info.height > 2560) throw new Error("Oversized cover");
  return bytes;
}
async function generateCover({ paths, source, hash, appRoot, config, signal, beforePublish }) {
  await assertCacheDirectory(paths, true);
  const target = path.join(paths.videoCoverDir, coverName(hash));
  const temporary = path.join(paths.videoCoverDir, `${randomUUID()}.tmp.webp`);
  const tools = resolveMediaToolPaths(appRoot, config);
  const options = { signal, timeoutMs: tools.config.thumbnailTimeoutSeconds * 1000 };
  try {
    const probe = JSON.parse(await runCoverTool(tools.ffprobePath,
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", source],
      { ...options, timeoutMs: tools.config.probeTimeoutSeconds * 1000 }));
    const streams = (probe.streams || []).filter(stream => stream.codec_type === "video");
    const stream = streams.find(candidate => candidate.disposition?.default === 1) || streams[0];
    const video = parseProbeJson(probe).video;
    const width = video.DisplayWidth, height = video.DisplayHeight;
    if (!stream || !width || !height || width * height > MAX_PIXELS || video.Width * video.Height > MAX_PIXELS)
      throw new Error("Video dimensions unavailable or exceed cover decoding limit");
    const scale = Math.min(1, 2560 / Math.max(width, height));
    const outputWidth = Math.max(1, Math.round(width * scale));
    const outputHeight = Math.max(1, Math.round(height * scale));
    await runCoverTool(tools.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-nostdin",
      "-max_alloc", "268435456", "-threads", "1", "-i", source, "-map", `0:${stream.index}`,
      "-frames:v", "1", "-an", "-sn", "-vf", `scale=${outputWidth}:${outputHeight},setsar=1`,
      "-c:v", "libwebp", "-quality", "90", "-threads", "1", "-y", temporary], options);
    const bytes = await readCover(temporary);
    await beforePublish();
    signal?.throwIfAborted();
    await assertCacheDirectory(paths);
    await fs.rename(temporary, target);
    return bytes;
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
async function pruneVideoCovers(paths, entries) {
  await assertCacheDirectory(paths);
  const retained = new Set(entries.filter(item => item.FileSystem?.FileType === "video").map(item => coverName(item.SHA256Hash)));
  const files = await fs.readdir(paths.videoCoverDir, { withFileTypes: true }).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const file of files) {
    if (file.isFile() && /^[a-f0-9]{64}\.v\d+-\d+-q\d+\.webp$/i.test(file.name) && !retained.has(file.name))
      await fs.unlink(path.join(paths.videoCoverDir, file.name));
  }
}
module.exports = { RECIPE, coverName, assertCacheDirectory, readCover, generateCover, pruneVideoCovers, runCoverTool };
