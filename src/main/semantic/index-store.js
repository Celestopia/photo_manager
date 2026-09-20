const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { writeTextAtomic } = require("../../../scripts/library-core");
const { rejectSymlinkPath } = require("./path-safety");
const { hash, profiles, dimensions, project } = require("./domain");
const hex = /^[a-f0-9]{64}$/;
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function exact(v, keys) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).sort().join() !== [...keys].sort().join()
  )
    throw new Error("Invalid semantic index record");
}
async function readPointer(paths) {
  const root = paths.semanticDir;
  await rejectSymlinkPath(root, { allowMissing: true });
  let pointer;
  try {
    await rejectSymlinkPath(path.join(root, "current.json"), {
      allowMissing: true,
    });
    pointer = JSON.parse(
      await fs.readFile(path.join(root, "current.json"), "utf8"),
    );
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  exact(pointer, ["version", "generation", "hash"]);
  if (
    pointer.version !== 1 ||
    !uuid.test(pointer.generation) ||
    !hex.test(pointer.hash)
  )
    throw new Error("Invalid semantic index pointer");
  return pointer;
}
async function readIndex(paths, libraryId, pointer) {
  pointer = pointer || (await readPointer(paths));
  if (!pointer) return null;
  const root = paths.semanticDir;
  const file = path.join(root, "generations", pointer.generation + ".json");
  await rejectSymlinkPath(file);
  const bytes = await fs.readFile(file);
  if (hash(bytes) !== pointer.hash)
    throw new Error("Corrupt semantic index manifest; rebuild the index");
  const value = JSON.parse(bytes);
  exact(value, ["version", "libraryId", "entries", "createdAt"]);
  if (
    value.version !== 1 ||
    value.libraryId !== libraryId ||
    !Array.isArray(value.entries) ||
    !Number.isFinite(Date.parse(value.createdAt))
  )
    throw new Error("Invalid semantic index identity");
  const seen = new Set();
  for (const e of value.entries) {
    exact(e, [
      "mediaId",
      "lane",
      "profile",
      "inputHash",
      "blob",
      "count",
      "expected",
      "parts",
    ]);
    if (
      !uuid.test(e.mediaId) ||
      !Object.hasOwn(dimensions, e.lane) ||
      ![e.profile, e.inputHash, e.blob].every(
        (x) => typeof x === "string" && hex.test(x),
      ) ||
      !Number.isInteger(e.count) ||
      e.count < 1 ||
      !Number.isInteger(e.expected) ||
      e.expected < e.count ||
      !Array.isArray(e.parts) ||
      e.parts.length !== e.count ||
      new Set(e.parts).size !== e.count ||
      e.parts.some((p) => !Number.isInteger(p) || p < 0 || p >= e.expected)
    )
      throw new Error("Invalid semantic index entry");
    const key = e.mediaId + ":" + e.lane;
    if (seen.has(key)) throw new Error("Duplicate semantic index entry");
    seen.add(key);
  }
  return { ...value, generation: pointer.generation };
}
async function readVectors(paths, e) {
  const file = path.join(paths.semanticDir, "objects", e.blob + ".f32");
  await rejectSymlinkPath(file);
  const bytes = await fs.readFile(file);
  const d = dimensions[e.lane];
  if (bytes.length !== e.count * d * 4 || hash(bytes) !== e.blob)
    throw new Error("Corrupt semantic vector file; rebuild the index");
  const vectors = [];
  for (let i = 0; i < e.count; i++) {
    const v = new Float32Array(d);
    let sum = 0;
    for (let j = 0; j < d; j++) {
      const x = bytes.readFloatLE((i * d + j) * 4);
      if (!Number.isFinite(x)) throw new Error("Invalid semantic vector");
      v[j] = x;
      sum += x * x;
    }
    if (Math.abs(sum - 1) > 0.002)
      throw new Error("Invalid semantic vector norm");
    vectors.push(v);
  }
  return vectors;
}
async function writeVectors(paths, lane, vectors) {
  const d = dimensions[lane],
    bytes = Buffer.alloc(vectors.length * d * 4);
  vectors.forEach((v, i) => {
    if (v.length !== d) throw new Error("Invalid embedding dimension");
    let norm = 0;
    v.forEach((x, j) => {
      if (!Number.isFinite(x)) throw new Error("Invalid embedding value");
      norm += x * x;
      bytes.writeFloatLE(x, (i * d + j) * 4);
    });
    if (Math.abs(norm - 1) > 0.002) throw new Error("Invalid embedding norm");
  });
  const blob = hash(bytes),
    dir = path.join(paths.semanticDir, "objects");
  await rejectSymlinkPath(dir, { allowMissing: true });
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, blob + ".f32");
  await rejectSymlinkPath(file, { allowMissing: true });
  // Content-addressed objects are immutable; a corrupt object is repaired only by explicit maintenance.
  let valid = false;
  try {
    valid = hash(await fs.readFile(file)) === blob;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (!valid) {
    const temp = file + "." + randomUUID() + ".tmp";
    await fs.writeFile(temp, bytes);
    await fs.rename(temp, file);
  }
  return blob;
}
async function publish(paths, libraryId, entries) {
  await rejectSymlinkPath(paths.semanticDir, { allowMissing: true });
  const dir = path.join(paths.semanticDir, "generations");
  await rejectSymlinkPath(dir, { allowMissing: true });
  await fs.mkdir(dir, { recursive: true });
  const generation = randomUUID(),
    bytes = JSON.stringify({
      version: 1,
      libraryId,
      entries: [...entries.values()],
      createdAt: new Date().toISOString(),
    });
  await writeTextAtomic(path.join(dir, generation + ".json"), bytes);
  await rejectSymlinkPath(path.join(paths.semanticDir, "current.json"), {
    allowMissing: true,
  });
  await writeTextAtomic(
    path.join(paths.semanticDir, "current.json"),
    JSON.stringify({ version: 1, generation, hash: hash(bytes) }),
  );
  return generation;
}
async function status(paths, libraryId, items, registries) {
  const index = await readIndex(paths, libraryId),
    byId = new Map(items.map((i) => [i.MediaId, i])),
    usable = new Set(),
    partial = new Set(),
    outdated = new Set();
  const projections = new Map(
    items.map((i) => [i.MediaId, project(i, registries)]),
  );
  for (const e of index?.entries || []) {
    if (!byId.has(e.mediaId)) continue;
    if (e.profile !== profiles[e.lane]) {
      outdated.add(e.mediaId);
      continue;
    }
    await readVectors(paths, e);
    usable.add(e.mediaId);
    if (e.count < e.expected) partial.add(e.mediaId);
    if (e.inputHash !== projections.get(e.mediaId).fingerprints[e.lane])
      outdated.add(e.mediaId);
  }
  const indexedKeys = new Set(
    (index?.entries || []).map((e) => e.mediaId + ":" + e.lane),
  );
  for (const i of items) {
    const p = projections.get(i.MediaId);
    for (const lane of ["visual", "description", "context"])
      if (
        (lane === "visual" || p[lane]) &&
        !indexedKeys.has(i.MediaId + ":" + lane)
      )
        partial.add(i.MediaId);
  }
  return {
    total: items.length,
    indexed: usable.size,
    missing: items.length - usable.size,
    partial: [...partial].filter((id) => usable.has(id)).length,
    outdated: outdated.size,
  };
}
// Only explicit maintenance prunes immutable artifacts, after search readers are stopped.
async function prune(paths, current, previous) {
  const keep = new Set(
      [current?.generation, previous?.generation].filter(Boolean),
    ),
    blobs = new Set(
      [...(current?.entries || []), ...(previous?.entries || [])].map(
        (e) => e.blob,
      ),
    );
  for (const [subdir, pattern, preserve] of [
    [
      "generations",
      /^[a-f0-9-]+\.json$/,
      (name) => keep.has(name.slice(0, -5)),
    ],
    ["objects", /^[a-f0-9]{64}\.f32$/, (name) => blobs.has(name.slice(0, -4))],
  ]) {
    const directory = path.join(paths.semanticDir, subdir);
    await rejectSymlinkPath(directory, { allowMissing: true });
    let names;
    try {
      names = await fs.readdir(directory);
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    for (const name of names)
      if (pattern.test(name) && !preserve(name)) {
        const file = path.join(directory, name);
        await rejectSymlinkPath(file);
        await fs.unlink(file);
      }
  }
}
module.exports = {
  readPointer,
  readIndex,
  readVectors,
  writeVectors,
  publish,
  status,
  prune,
};
