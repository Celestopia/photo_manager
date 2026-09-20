const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const sharp = require("sharp");
const { assertPathInsideLibrary } = require("../../../scripts/library-core");
const { resolveMediaToolPaths } = require("../../../scripts/media-tools");
const { sampleCount, selectFrames } = require("./domain");
const { rejectSymlinkPath } = require("./path-safety");
function run(exe, args, signal, maxBuffer = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    execFile(
      exe,
      args,
      {
        windowsHide: true,
        encoding: "buffer",
        maxBuffer,
        timeout: 1800000,
        signal,
      },
      (e, out) =>
        e
          ? reject(
              new Error(
                signal?.aborted
                  ? "Sampling cancelled"
                  : "Media sampling failed or exceeded its resource limit",
              ),
            )
          : resolve(out),
    );
  });
}
async function resolveSource(paths, item) {
  const file = assertPathInsideLibrary(
    paths,
    path.resolve(paths.root, item.FilePath),
  );
  const stat = await fs.stat(file);
  if (
    !stat.isFile() ||
    stat.size !== item.FileSystem.FileSize ||
    Math.abs(stat.mtimeMs - item.FileSystem.ModificationTimeMs) > 1
  )
    throw new Error("Source changed; run Update Metadata first");
  return file;
}
async function* frames(
  paths,
  item,
  { resourceRoot, mediaConfig, signal } = {},
) {
  const source = await resolveSource(paths, item);
  signal?.throwIfAborted();
  if (item.FileSystem.FileType === "video") {
    const n = sampleCount(item.Video?.DurationSeconds),
      tools = resolveMediaToolPaths(resourceRoot, mediaConfig);
    // Enumerate presentation timestamps, not nominal FPS. This also handles very short/VFR clips.
    const output = await run(
      tools.ffprobePath,
      [
        "-v",
        "error",
        "-threads",
        "2",
        "-select_streams",
        "v:0",
        "-show_frames",
        "-show_entries",
        "frame=best_effort_timestamp_time:frame_side_data=",
        "-of",
        "json",
        source,
      ],
      signal,
    );
    // CSV side data may contain numeric-looking lines from rotation matrices.
    // Frame objects preserve source identity without interpreting that side data.
    const times = (JSON.parse(output.toString()).frames || []).map(frame =>
      typeof frame.best_effort_timestamp_time === "string" && frame.best_effort_timestamp_time.trim()
        ? Number(frame.best_effort_timestamp_time) : NaN,
    );
    if (
      !times.length ||
      times.some((t, i) => !Number.isFinite(t) || (i && t < times[i - 1]))
    )
      throw new Error("Video presentation timestamps unavailable");
    const selected = selectFrames(times, n);
    // Keep FFmpeg's expression parser below its recursion limit at 120 samples.
    const groups = [];
    for (let i = 0; i < selected.length; i += 10)
      groups.push(`(${selected.slice(i, i + 10).map((n) => `eq(n\\,${n})`).join("+")})`);
    await rejectSymlinkPath(paths.tempDir, { allowMissing: true });
    await fs.mkdir(paths.tempDir, { recursive: true });
    const temp = await fs.mkdtemp(path.join(paths.tempDir, "semantic-frames-"));
    try {
      // Decode once, selecting by source identity; never repeat a long video for every target.
      let failure;
      try {
        await run(
          tools.ffmpegPath,
          [
            "-v",
            "error",
            "-i",
            source,
            "-vf",
            `select=${groups.join("+")},scale=w='iw*sar*min(1,min(1024/(iw*sar),1024/ih))':h='ih*min(1,min(1024/(iw*sar),1024/ih))',setsar=1`,
            "-frames:v",
            String(selected.length),
            "-fps_mode",
            "passthrough",
            "-start_number",
            "0",
            path.join(temp, "%06d.png"),
          ],
          signal,
        );
      } catch (e) {
        signal?.throwIfAborted();
        failure = e;
      }
      for (let part = 0; part < selected.length; part++) {
        signal?.throwIfAborted();
        try {
          const image = await fs.readFile(
            path.join(temp, String(part).padStart(6, "0") + ".png"),
          );
          yield {
            image,
            part,
            expected: selected.length,
            timestamp: times[selected[part]],
          };
        } catch {
          yield {
            part,
            expected: selected.length,
            error: failure?.message || "Sampled frame is unavailable",
          };
        }
      }
    } finally {
      const relative = path.relative(
        path.resolve(paths.tempDir),
        path.resolve(temp),
      );
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative))
        await fs.rm(temp, { recursive: true, force: true });
    }
  } else if (/\.gif$/i.test(item.FilePath)) {
    const info = await sharp(source).metadata(),
      pages = info.pages || 1,
      delays = info.delay || [],
      times = [0];
    for (let i = 1; i < pages; i++)
      times.push(times.at(-1) + (delays[i - 1] || 100) / 1000);
    const selected = selectFrames(times, 8);
    for (let part = 0; part < selected.length; part++) {
      signal?.throwIfAborted();
      yield {
        image: await sharp(source, {
          page: selected[part],
          pages: 1,
          limitInputPixels: 100000000,
        })
          .rotate()
          .png()
          .toBuffer(),
        part,
        expected: selected.length,
        timestamp: times[selected[part]],
      };
    }
  } else
    yield {
      image: await sharp(source, { limitInputPixels: 100000000 })
        .rotate()
        .toColourspace("srgb")
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer(),
      part: 0,
      expected: 1,
      timestamp: null,
    };
}
module.exports = { frames, resolveSource };
