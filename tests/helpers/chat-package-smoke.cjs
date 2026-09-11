/* Run under the packaged Electron executable with ELECTRON_RUN_AS_NODE=1. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const resources = path.resolve("release/win-unpacked/resources");
const code = path.join(resources, "app.asar");
const inputs = require(path.join(code, "src/main/chat/inputs.js"));
const { resolveMediaToolPaths, runMediaTool } = require(
  path.join(code, "scripts/media-tools.js"),
);
const tools = resolveMediaToolPaths(resources, {});
async function run() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "photo-manager-chat-package-"),
  );
  try {
    const video = path.join(root, "video.mp4");
    await runMediaTool(tools.ffmpegPath, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=32x32:r=10",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-y",
      video,
    ]);
    const info = await inputs.inspect(video, { video: true, tools });
    const frames = await inputs.prepare(video, info, "sampled", 3, { tools });
    assert.equal(frames.length, 3);
    assert.ok(frames.every((f) => f.mime === "image/jpeg" && f.width === 32));
    const image = path.join(root, "image.jpg");
    await fs.writeFile(image, frames[0].bytes);
    const imageInfo = await inputs.inspect(image);
    const [original] = await inputs.prepare(image, imageInfo, "original", 1, {
      tools,
    });
    assert.deepEqual(original.bytes, frames[0].bytes);
    console.log(
      "CHAT_PACKAGE_SMOKE_PASS: packaged ASAR modules, Sharp, bundled FFmpeg and original bytes.",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
