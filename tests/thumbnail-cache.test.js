const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { generateVideoThumbnail, normalizeThumbnailConfig } = require("../scripts/thumbnail-cache");

test("video thumbnail generation falls back to the first frame and removes its temporary PNG", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "photo-manager-thumbnail-test-"));
  try {
    const targetPath = path.join(root, "thumbnail.webp");
    const seekCalls = [];
    await generateVideoThumbnail(
      { Video: { DurationSeconds: 20 } },
      path.join(root, "source.mp4"),
      targetPath,
      normalizeThumbnailConfig({ size: 160 }),
      {},
      {
        extractVideoFrame: async (_source, tempPath, seekTime) => {
          seekCalls.push(seekTime);
          if (seekTime > 0) throw new Error("target frame unavailable");
          await fsp.writeFile(tempPath, "temporary frame");
        },
        generateThumbnail: async (_tempPath, outputPath) => {
          await fsp.writeFile(outputPath, "webp thumbnail");
        },
      },
    );
    assert.deepEqual(seekCalls, [2, 0]);
    assert.equal((await fsp.stat(targetPath)).isFile(), true);
    const remaining = await fsp.readdir(root);
    assert.equal(remaining.some((name) => name.endsWith(".png")), false);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("failed video thumbnail rendering removes partial cache output", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "photo-manager-thumbnail-failure-test-"));
  try {
    const targetPath = path.join(root, "partial.webp");
    await assert.rejects(generateVideoThumbnail(
      { Video: { DurationSeconds: null } },
      path.join(root, "source.mp4"),
      targetPath,
      normalizeThumbnailConfig({ size: 160 }),
      {},
      {
        extractVideoFrame: async (_source, tempPath) => fsp.writeFile(tempPath, "temporary frame"),
        generateThumbnail: async (_tempPath, outputPath) => {
          await fsp.writeFile(outputPath, "partial output");
          throw new Error("encode failed");
        },
      },
    ));
    await assert.rejects(fsp.stat(targetPath), { code: "ENOENT" });
    const remaining = await fsp.readdir(root);
    assert.equal(remaining.some((name) => name.endsWith(".png")), false);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
