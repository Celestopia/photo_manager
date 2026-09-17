const { execFile } = require("node:child_process");
const { resolveMediaToolPaths, parseProbeJson } = require("./media-tools.js");
const MAX_PIXELS = 64 * 1024 * 1024;

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
async function extractFirstVideoFrame(source, target, appRoot, config, { signal, maxEdge = 2560, webp = false } = {}) {
  const tools = resolveMediaToolPaths(appRoot, config);
  const options = { signal, timeoutMs: tools.config.thumbnailTimeoutSeconds * 1000 };
  const probe = JSON.parse(await runCoverTool(tools.ffprobePath,
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", source],
    { ...options, timeoutMs: tools.config.probeTimeoutSeconds * 1000 }));
  const streams = (probe.streams || []).filter(stream => stream.codec_type === "video");
  const stream = streams.find(candidate => candidate.disposition?.default === 1) || streams[0];
  const video = parseProbeJson(probe).video;
  const width = video.DisplayWidth, height = video.DisplayHeight;
  if (!stream || !width || !height || width * height > MAX_PIXELS || video.Width * video.Height > MAX_PIXELS)
    throw new Error("Video dimensions unavailable or exceed cover decoding limit");
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const outputWidth = Math.max(1, Math.round(width * scale));
  const outputHeight = Math.max(1, Math.round(height * scale));
  await runCoverTool(tools.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-nostdin",
    "-max_alloc", "268435456", "-threads", "1", "-i", source, "-map", `0:${stream.index}`,
    "-frames:v", "1", "-an", "-sn", "-vf", `scale=${outputWidth}:${outputHeight},setsar=1`,
    ...(webp ? ["-c:v", "libwebp", "-quality", "90"] : ["-c:v", "png"]),
    "-threads", "1", "-y", target], options);
}
module.exports = { runCoverTool, extractFirstVideoFrame };
