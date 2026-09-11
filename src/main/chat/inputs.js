const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFile } = require("node:child_process");
const sharp = require("sharp");
const MiB = 1024 * 1024;
const IMAGE_TYPES = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
};
const EXTENSIONS = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  gif: "gif",
  bmp: "bmp",
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fingerprint(file, signal) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    signal?.throwIfAborted();
    h.update(chunk);
  }
  return h.digest("hex");
}
function run(exe, args, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    // execFile calls back only after termination, so cancellation drains the child.
    execFile(
      exe,
      args,
      {
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 12 * MiB,
        encoding: "buffer",
        signal,
      },
      (err, stdout, stderr) => {
        if (err)
          reject(
            new Error(
              signal?.aborted
                ? "Preparation cancelled"
                : "Media preparation failed. Check the file and configured FFmpeg tools.",
            ),
          );
        else resolve({ stdout, stderr: stderr.toString("utf8") });
      },
    );
  });
}
async function inspect(file, { video = false, tools, signal } = {}) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || !stat.size)
    throw new Error("Input is not a nonempty file");
  if (video) {
    const { stdout } = await run(
      tools.ffprobePath,
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
      signal,
    );
    const data = JSON.parse(stdout.toString());
    const stream = data.streams.find(
      (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
    );
    const duration = Number(stream?.duration || data.format?.duration);
    if (
      !stream ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 1800
    )
      throw new Error(
        "Videos must have a positive duration of at most 30 minutes.",
      );
    const [rateNumerator, rateDenominator] = String(
      stream.avg_frame_rate || "0/1",
    )
      .split("/")
      .map(Number);
    const frameInterval =
      rateNumerator > 0 && rateDenominator > 0
        ? rateDenominator / rateNumerator
        : 0.1;
    return {
      kind: "video",
      mime: "video/*",
      size: stat.size,
      width: stream.width,
      height: stream.height,
      duration,
      frameInterval,
      streamIndex: stream.index,
    };
  }
  const ext = path.extname(file).slice(1).toLowerCase();
  if (["txt", "md", "csv", "json"].includes(ext)) {
    if (stat.size > MiB)
      throw new Error("Text attachments must be at most 1 MiB.");
    const bytes = await fs.readFile(file);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("Text attachments must use valid UTF-8.");
    }
    if (text.includes("\0"))
      throw new Error("This file contains binary data, not supported text.");
    if (text.length > 32000)
      throw new Error(
        "Text attachments must contain at most 32,000 characters.",
      );
    return {
      kind: "text",
      mime: "text/plain",
      extension: ext,
      size: stat.size,
      width: null,
      height: null,
      text,
    };
  }
  if (!["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(ext))
    throw new Error(
      "Unsupported attachment. Use static images, animated GIFs or UTF-8 text files. PDF, Office, archives, audio and external videos are not supported.",
    );
  if (ext === "bmp") {
    const handle = await fs.open(file, "r");
    const header = Buffer.alloc(54);
    try {
      await handle.read(header, 0, 54, 0);
    } finally {
      await handle.close();
    }
    const width = header.readInt32LE(18),
      height = Math.abs(header.readInt32LE(22));
    if (
      header.toString("ascii", 0, 2) !== "BM" ||
      header.readUInt32LE(14) < 40 ||
      width < 1 ||
      height < 1 ||
      width * height > 100000000
    )
      throw new Error("Unsupported or oversized BMP image.");
    return {
      kind: "image",
      mime: "image/bmp",
      extension: "bmp",
      size: stat.size,
      width,
      height,
      pages: 1,
      delays: [],
    };
  }
  let meta;
  try {
    const bytes = await fs.readFile(file);
    if (ext === "png") {
      for (let offset = 8; offset + 12 <= bytes.length;) {
        const size = bytes.readUInt32BE(offset);
        if (bytes.toString("ascii", offset + 4, offset + 8) === "acTL") {
          throw new Error("Unsupported animation");
        }
        offset += size + 12;
      }
    }
    meta = await sharp(bytes, {
      limitInputPixels: 100000000,
    }).metadata();
  } catch (error) {
    if (error.message === "Unsupported animation") {
      throw new Error("Only GIF animation is supported. Convert this animated image before attaching it.");
    }
    throw new Error(
      "Cannot decode this image, or it exceeds 100 million pixels.",
    );
  }
  if (
    !IMAGE_TYPES[meta.format] ||
    ((ext === "jpg" ? "jpeg" : ext) !== meta.format &&
      !(ext === "jpeg" && meta.format === "jpeg"))
  )
    throw new Error("The image contents do not match a supported extension.");
  if (meta.pages > 1 && meta.format !== "gif")
    throw new Error(
      "Only GIF animation is supported. Convert this animated image before attaching it.",
    );
  const animated = meta.format === "gif" && meta.pages > 1;
  if (
    animated &&
    (!meta.delay ||
      meta.delay.length !== meta.pages ||
      meta.delay.some((v) => !Number.isFinite(v) || v <= 0))
  )
    throw new Error("The GIF has invalid frame timing.");
  return {
    kind: animated ? "gif" : "image",
    mime: IMAGE_TYPES[meta.format],
    extension: EXTENSIONS[meta.format],
    size: stat.size,
    width: meta.width,
    height: meta.pageHeight || meta.height,
    pages: meta.pages || 1,
    delays: meta.delay || [],
  };
}
async function optimized(source, options = {}) {
  if (
    typeof source === "string" &&
    path.extname(source).toLowerCase() === ".bmp"
  ) {
    if (!options.tools)
      throw new Error("BMP preparation requires the configured FFmpeg tools.");
    source = (
      await run(
        options.tools.ffmpegPath,
        [
          "-v",
          "error",
          "-i",
          source,
          "-frames:v",
          "1",
          "-f",
          "image2pipe",
          "-vcodec",
          "png",
          "pipe:1",
        ],
        options.signal,
      )
    ).stdout;
  }
  // Buffer input prevents libvips' file cache from retaining Windows attachment handles.
  if (typeof source === "string") source = await fs.readFile(source);
  for (const [size, quality] of [
    [1024, 85],
    [1024, 75],
    [1024, 60],
    [768, 60],
    [512, 60],
  ]) {
    options.signal?.throwIfAborted();
    const pipeline = sharp(source, {
      limitInputPixels: 100000000,
      ...(options.page === undefined ? {} : { page: options.page, pages: 1 }),
    });
    const result = await pipeline
      .rotate()
      .toColourspace("srgb")
      .flatten({ background: "#ffffff" })
      .resize({
        width: size,
        height: size,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality })
      .toBuffer({ resolveWithObject: true });
    options.signal?.throwIfAborted();
    if (result.data.length <= MiB)
      return {
        bytes: result.data,
        width: result.info.width,
        height: result.info.height,
        mime: "image/jpeg",
        transformation:
          "Auto-oriented; sRGB; white transparency background; optimized JPEG",
      };
  }
  throw new Error("The optimized image could not fit within 1 MiB.");
}
function allocation(infos, slots = 8) {
  const counts = infos.map((i) =>
    i.kind === "text" ? 0 : i.kind === "image" ? 1 : 2,
  );
  if (counts.reduce((a, b) => a + b, 0) > slots)
    throw new Error(
      "Too many visual inputs. Each video or animated GIF needs at least two frames; remove an input.",
    );
  let left = slots - counts.reduce((a, b) => a + b, 0),
    progress = true;
  while (left && progress) {
    progress = false;
    infos.forEach((i, n) => {
      const cap =
        i.kind === "video"
          ? 8
          : i.kind === "gif"
            ? Math.min(4, i.pages)
            : counts[n];
      if (left && counts[n] < cap) {
        counts[n]++;
        left--;
        progress = true;
      }
    });
  }
  return counts;
}
function gifSamples(delays, count) {
  const starts = [];
  let duration = 0;
  for (const d of delays) {
    starts.push(duration);
    duration += d;
  }
  const selected = new Set();
  for (let n = 0; n < count; n++) {
    const target = (n * (duration - 0.001)) / (count - 1);
    let index = starts.findLastIndex((t) => t <= target);
    selected.add(index);
  }
  // Long delays can map several targets onto one frame. Fill nearest remaining frames.
  for (let n = 0; selected.size < count && n < starts.length; n++)
    selected.add(n);
  return [...selected]
    .sort((a, b) => a - b)
    .map((index) => ({ index, time: starts[index] / 1000 }));
}
async function prepare(file, info, mode, count, { tools, signal } = {}) {
  signal?.throwIfAborted();
  if (info.kind === "text") return [];
  if (info.kind === "image") {
    if (mode === "original") {
      if (info.size > 20 * MiB)
        throw new Error(
          "Original file exceeds 20 MiB. Choose Optimized for chat or remove it.",
        );
      return [
        {
          bytes: await fs.readFile(file),
          width: info.width,
          height: info.height,
          mime: info.mime,
          transformation: "Original file; unchanged bytes",
          timestamp: null,
          frameIndex: null,
        },
      ];
    }
    return [
      {
        ...(await optimized(file, { signal, tools })),
        timestamp: null,
        frameIndex: null,
      },
    ];
  }
  const results = [];
  if (info.kind === "gif") {
    for (const sample of gifSamples(info.delays, Math.min(count, info.pages))) {
      results.push({
        ...(await optimized(file, { page: sample.index, signal })),
        timestamp: sample.time,
        frameIndex: sample.index,
      });
    }
  } else {
    for (let n = 0; n < count; n++) {
      const target =
        (n * Math.max(0, info.duration - Math.max(info.frameInterval, 0.001))) /
        (count - 1);
      const { stdout, stderr } = await run(
        tools.ffmpegPath,
        [
          "-hide_banner",
          "-loglevel",
          "info",
          "-ss",
          String(target),
          "-copyts",
          "-i",
          file,
          "-map",
          `0:${info.streamIndex}`,
          "-frames:v",
          "1",
          "-an",
          "-vf",
          "scale=trunc(iw*sar):ih,setsar=1,showinfo",
          "-f",
          "image2pipe",
          "-vcodec",
          "png",
          "pipe:1",
        ],
        signal,
      );
      const matches = [...stderr.matchAll(/\bn:\s*(\d+).*?pts_time:([\d.]+)/g)];
      if (!stdout.length || !matches.length)
        throw new Error("A requested video sample could not be extracted.");
      const timestamp = Number(matches[0][2]);
      if (results.some((r) => r.timestamp === timestamp)) continue;
      results.push({
        ...(await optimized(stdout, { signal })),
        timestamp,
        frameIndex: null,
      });
    }
  }
  if (results.length < 2)
    throw new Error(
      "Moving media requires at least two distinct source frames.",
    );
  return results;
}
module.exports = {
  MiB,
  hash,
  fingerprint,
  inspect,
  optimized,
  allocation,
  gifSamples,
  prepare,
};
