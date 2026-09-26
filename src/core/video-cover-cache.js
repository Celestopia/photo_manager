const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const sharp = require("sharp");
const { extractFirstVideoFrame } = require("./video-first-frame.js");
const { assertPathInsideLibrary } = require("./library-core.js");

async function checkCoverSource(paths, item, source) {
  assertPathInsideLibrary(paths, source);
  const stat = await fs.stat(source);
  if (!stat.isFile() || stat.size !== item.FileSystem.FileSize || stat.mtimeMs !== item.FileSystem.ModificationTimeMs)
    throw Object.assign(new Error(`Source changed; update library metadata (expected size=${item.FileSystem.FileSize} mtimeMs=${item.FileSystem.ModificationTimeMs}; actual size=${stat.size} mtimeMs=${stat.mtimeMs})`), { code: "SOURCE_CHANGED" });
}

const RECIPE = "v1-2560-q90";
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
// Reuse checks inspect headers only; newly generated output still receives a full decode.
async function checkExistingCover(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > 32 * 1024 * 1024)
    throw new Error("Invalid video cover file");
  // Buffer input avoids libvips retaining a file handle on Windows.
  const metadata = await sharp(await fs.readFile(file), { limitInputPixels: 2560 * 2560 }).metadata();
  if (metadata.format !== "webp" || !(metadata.width > 0 && metadata.width <= 2560)
    || !(metadata.height > 0 && metadata.height <= 2560) || (metadata.pages || 1) !== 1)
    throw new Error("Invalid video cover header");
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
  let stage = "extract";
  try {
    await extractFirstVideoFrame(source, temporary, appRoot, config, { signal, webp: true });
    stage = "validate-output";
    const bytes = await readCover(temporary);
    stage = "source-check";
    await beforePublish();
    signal?.throwIfAborted();
    stage = "publish";
    await assertCacheDirectory(paths);
    await fs.rename(temporary, target);
    return bytes;
  } catch (error) {
    error.stage = stage;
    throw error;
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
module.exports = { RECIPE, coverName, assertCacheDirectory, checkExistingCover, readCover, generateCover, pruneVideoCovers, checkCoverSource };
