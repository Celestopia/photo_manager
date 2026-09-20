const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const sharp = require("sharp");
const { resolveLibraryPaths } = require("../scripts/library-core");
const { frames } = require("../src/main/semantic/media-assets");
const resourceRoot = path.resolve(__dirname, "..");

test("video sampling decodes distinct source frames, preserves aspect, handles rotation side data, caps short clips and cleans temp files", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "semantic-video-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const paths = resolveLibraryPaths(root);
  for (const count of [5, 10, 11, 30, 120]) {
    const rate = count === 120 ? 1 / 6 : 10;
    let source = path.join(root, `${count}.mp4`);
    await execFile(
      path.join(resourceRoot, "tools/ffmpeg/bin/ffmpeg.exe"),
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=160x90:rate=${count === 120 ? "1/6" : "10"}`,
        "-frames:v",
        String(count),
        "-c:v",
        "libx264",
        source,
      ],
      { windowsHide: true },
    );
    if (count === 11) {
      const rotated = path.join(root, "rotated.mp4");
      await execFile(path.join(resourceRoot, "tools/ffmpeg/bin/ffmpeg.exe"), [
        "-v", "error", "-display_rotation", "90", "-i", source, "-c", "copy", rotated,
      ], { windowsHide: true });
      source = rotated;
      const { stdout } = await execFile(path.join(resourceRoot, "tools/ffmpeg/bin/ffprobe.exe"), [
        "-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries",
        "frame=best_effort_timestamp_time", "-of", "csv=p=0", source,
      ], { windowsHide: true });
      assert.match(stdout, /00000000:/, "Fixture must expose numeric-looking rotation side data");
    }
    const stat = await fs.stat(source);
    const item = {
      FilePath: path.basename(source),
      FileSystem: {
        FileType: "video",
        FileSize: stat.size,
        ModificationTimeMs: stat.mtimeMs,
      },
      Video: { DurationSeconds: count / rate },
    };
    const sampled = [];
    for await (const frame of frames(paths, item, { resourceRoot }))
      sampled.push(frame);
    assert.equal(sampled.length, count === 120 ? 120 : Math.min(count, 10));
    assert.equal(new Set(sampled.map((f) => f.timestamp)).size, sampled.length);
    assert.equal(sampled[0].timestamp, 0);
    assert.equal(sampled.at(-1).timestamp, (count - 1) / rate);
    for (const frame of sampled) {
      assert.equal(frame.error, undefined);
      const info = await sharp(frame.image).metadata();
      assert.equal(info.width / info.height, count === 11 ? 9 / 16 : 16 / 9);
    }
    assert.deepEqual(await fs.readdir(paths.tempDir), []);
    const signal = AbortSignal.abort();
    await assert.rejects(async () => {
      for await (const _ of frames(paths, item, { resourceRoot, signal })) {
      }
    });
    assert.deepEqual(await fs.readdir(paths.tempDir), []);
  }
});
