const fs = require("node:fs/promises");
const {
  readIndex,
  readVectors,
  writeVectors,
  publish,
  prune,
} = require("./index-store");
const { project, profiles } = require("./domain");
const { frames, resolveSource } = require("./media-assets");
const { digest } = require("./model-assets");
async function buildIndex({
  paths,
  libraryId,
  items,
  registries,
  embeddings,
  force = false,
  signal,
  onProgress = () => {},
  resourceRoot,
  mediaConfig,
  frameSource = frames,
}) {
  let old;
  try {
    old = await readIndex(paths, libraryId);
  } catch (e) {
    if (!force) throw e;
    old = null;
  }
  const live = new Set(items.map((i) => i.MediaId)),
    entries = new Map();
  for (const e of old?.entries || [])
    if (live.has(e.mediaId)) entries.set(e.mediaId + ":" + e.lane, e);
  const stats = {
    generated: 0,
    reused: 0,
    failed: 0,
    partial: 0,
    cancelled: false,
  };
  let dirty = entries.size !== (old?.entries.length || 0),
    since = 0;
  const projection = new Map(
    items.map((i) => [i.MediaId, project(i, registries)]),
  );
  const total = items.length * 3;
  let processed = 0;
  async function checkpoint() {
    if (!dirty) return;
    await publish(paths, libraryId, entries);
    dirty = false;
    since = 0;
  }
  try {
    for (const lane of ["description", "context", "visual"])
      for (const item of items) {
        signal?.throwIfAborted();
        const p = projection.get(item.MediaId),
          key = item.MediaId + ":" + lane,
          prior = entries.get(key);
        onProgress({
          phase: lane,
          processed: processed++,
          total,
          current: item.FilePath,
          message: "Building semantic index",
        });
        if (lane !== "visual" && !p[lane]) {
          if (entries.delete(key)) dirty = true;
          continue;
        }
        if (
          !force &&
          prior?.profile === profiles[lane] &&
          prior.inputHash === p.fingerprints[lane] &&
          prior.count === prior.expected
        ) {
          try {
            await readVectors(paths, prior);
            stats.reused++;
            continue;
          } catch {
            /* Explicit maintenance repairs invalid objects. */
          }
        }
        try {
          const space = await fs.statfs(paths.managerDir);
          if (space.bavail * space.bsize < 128 * 1024 * 1024)
            throw Object.assign(
              new Error("Not enough disk space to build semantic index"),
              { code: "ENOSPC" },
            );
          let vectors = [],
            parts = [],
            expected = 0;
          if (lane === "visual") {
            const source = await resolveSource(paths, item);
            if ((await digest(source, signal)) !== item.SHA256Hash)
              throw new Error("Source content changed; run Update Metadata");
            for await (const frame of frameSource(paths, item, {
              resourceRoot,
              mediaConfig,
              signal,
            })) {
              signal?.throwIfAborted();
              expected = frame.expected;
              if (frame.error) continue;
              try {
                const [v] = await embeddings.encode(
                  "image",
                  [frame.image],
                  signal,
                );
                vectors.push(v);
                parts.push(frame.part);
              } catch (e) {
                signal?.throwIfAborted();
                throw e;
              }
            }
            await resolveSource(paths, item);
          } else {
            const [chunks] = await embeddings.encode(
              "metadata",
              [p[lane]],
              signal,
            );
            vectors = chunks.map((c) => c.vector);
            parts = chunks.map((_, i) => i);
            expected = parts.length;
          }
          if (!vectors.length)
            throw new Error("No usable embeddings generated");
          // Retain good existing samples when retrying the same incomplete input.
          if (
            prior?.inputHash === p.fingerprints[lane] &&
            prior.profile === profiles[lane] &&
            prior.expected === expected &&
            vectors.length < expected
          ) {
            try {
              const oldVectors = await readVectors(paths, prior);
              prior.parts.forEach((part, i) => {
                if (!parts.includes(part)) {
                  parts.push(part);
                  vectors.push(oldVectors[i]);
                }
              });
            } catch {}
          }
          const blob = await writeVectors(paths, lane, vectors);
          entries.set(key, {
            mediaId: item.MediaId,
            lane,
            profile: profiles[lane],
            inputHash: p.fingerprints[lane],
            blob,
            count: vectors.length,
            expected,
            parts,
          });
          dirty = true;
          stats.generated++;
          if (vectors.length < expected) stats.partial++;
        } catch (e) {
          signal?.throwIfAborted();
          if (["ENOSPC", "EACCES", "EPERM", "EIO", "EROFS"].includes(e.code))
            throw e;
          stats.failed++;
          onProgress({
            phase: lane,
            processed,
            total,
            message: `Embedding unavailable: ${item.FilePath}: ${e.message}`,
          });
        }
        if (++since >= 32) await checkpoint();
      }
  } catch (e) {
    if (signal?.aborted) stats.cancelled = true;
    else throw e;
  } finally {
    await checkpoint();
  }
  if (!stats.cancelled)
    await prune(paths, await readIndex(paths, libraryId), old);
  onProgress({
    phase: "complete",
    processed,
    total,
    message: stats.cancelled
      ? "Index build stopped; completed work retained"
      : "Semantic index build complete",
  });
  return stats;
}
module.exports = { buildIndex };
