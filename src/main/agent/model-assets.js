const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const manifest = require("./model-manifest.json");
const { rejectSymlinkPath } = require("./path-safety");
async function digest(file, signal) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(file)) { signal?.throwIfAborted(); hash.update(chunk); }
  return hash.digest("hex");
}
function createModelAssets(root) {
  let controller = null;
  function directory(model) { return path.join(root, model.repository, model.revision); }
  async function valid(file, entry) {
    try { await rejectSymlinkPath(file); const s = await fs.lstat(file); return s.isFile() && !s.isSymbolicLink() && s.size === entry.size && await digest(file) === entry.sha256; } catch { return false; }
  }
  async function status() {
    return Promise.all(manifest.models.map(async m => {
      let installed = 0;
      for (const entry of m.files) if (await valid(path.join(directory(m), entry.path), entry)) installed++;
      return { id: m.id, repository: m.repository, revision: m.revision, directory: directory(m), bytes: m.files.reduce((n, e) => n + e.size, 0), ready: installed === m.files.length, installed, files: m.files.length };
    }));
  }
  async function install({ signal, onProgress = () => {}, importRoot } = {}) {
    if (controller) throw new Error("A model installation is already running");
    controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      await fs.mkdir(root, { recursive: true });
      const space = await fs.statfs(root);
      if (space.bavail * space.bsize < 1024 ** 3) throw new Error("At least 1 GiB free disk is required");
      for (const model of manifest.models) for (const entry of model.files) {
        combined.throwIfAborted();
        const target = path.join(directory(model), entry.path);
        await rejectSymlinkPath(target, { allowMissing: true });
        await rejectSymlinkPath(`${target}.partial`, { allowMissing: true });
        if (await valid(target, entry)) continue;
        await fs.mkdir(path.dirname(target), { recursive: true });
        const partial = `${target}.partial`;
        if (importRoot) {
          const source = path.join(importRoot, model.repository, model.revision, entry.path);
          if (!await valid(source, entry)) throw new Error(`Invalid imported model artifact: ${model.id}/${entry.path}`);
          await fs.copyFile(source, partial);
        } else {
          let offset = 0;
          try { offset = (await fs.stat(partial)).size; } catch {}
          if (offset > entry.size) { await fs.rm(partial); offset = 0; }
          if (offset < entry.size) {
            const response = await fetch(`https://huggingface.co/${model.repository}/resolve/${model.revision}/${entry.path}`, {
              signal: combined, headers: offset ? { Range: `bytes=${offset}-` } : {},
            });
            if (!response.ok) throw new Error(`Model download HTTP ${response.status}`);
            if (response.status !== 206) offset = 0;
            const file = await fs.open(partial, offset ? "a" : "w");
            try {
              for await (const chunk of response.body) {
                combined.throwIfAborted();
                offset += chunk.length;
                if (offset > entry.size) throw new Error("Model artifact exceeds pinned size");
                let written = 0;
                while (written < chunk.length) {
                  const result = await file.write(chunk, written, chunk.length - written);
                  if (!result.bytesWritten) throw new Error("Model cache write made no progress");
                  written += result.bytesWritten;
                }
                onProgress({ model: model.id, file: entry.path, completed: offset, total: entry.size });
              }
            } finally { await file.close(); }
          }
        }
        if (!await valid(partial, entry)) { await fs.rm(partial, { force: true }); throw new Error("Model artifact checksum mismatch"); }
        await fs.rename(partial, target);
      }
      return status();
    } finally { controller = null; }
  }
  return { status, install, cancel: () => controller?.abort(), directory, manifest };
}
module.exports = { createModelAssets, digest };
