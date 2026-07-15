const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fsp = require("node:fs/promises");
const {
  resolveLibraryPaths,
  createLibraryManifest,
  writeLibraryManifest,
  readLibraryManifest,
  ensureLibraryDirectories,
  readJsonlStrict,
  writeJsonlAtomic,
  findParentManagerDirectory,
  assertPathInsideLibrary,
  parseLibraryArgument,
} = require("../scripts/library-core");
const { walkFiles, buildMetadata } = require("../scripts/common");

async function temporaryDirectory(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "photo-manager-library-test-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("library paths are derived exclusively below the selected root", async (t) => {
  const root = await temporaryDirectory(t);
  const paths = resolveLibraryPaths(root);
  assert.equal(paths.managerDir, path.join(root, ".photo_manager"));
  assert.equal(paths.metadataFile, path.join(root, ".photo_manager", "data", "photo_metadata.jsonl"));
  assert.throws(() => resolveLibraryPaths(path.parse(root).root), /drive root/i);
  assert.throws(() => assertPathInsideLibrary(paths, path.join(root, "..", "outside.jpg")), /escapes the active library/i);
  assert.throws(() => assertPathInsideLibrary(paths, path.join(paths.managerDir, "cache.webp")), /PhotoManager-owned data/i);
  assert.throws(() => parseLibraryArgument([]), /Missing required argument/);
});

test("library manifest round-trips with a validated UUID and name", async (t) => {
  const root = await temporaryDirectory(t);
  const paths = resolveLibraryPaths(root);
  await ensureLibraryDirectories(paths);
  const manifest = createLibraryManifest(root, "Test Library");
  assert.equal(manifest.schemaVersion, 3);
  await writeLibraryManifest(paths, manifest);
  assert.deepEqual(await readLibraryManifest(paths), manifest);

  const descriptiveVersion = { ...manifest, schemaVersion: 17 };
  await writeLibraryManifest(paths, descriptiveVersion);
  assert.deepEqual(await readLibraryManifest(paths), descriptiveVersion);
});

test("strict JSONL rejects invalid lines and duplicate keys", async (t) => {
  const root = await temporaryDirectory(t);
  const file = path.join(root, "items.jsonl");
  await fsp.writeFile(file, '{"Name":"A"}\nnot-json\n', "utf8");
  await assert.rejects(readJsonlStrict(file, { keyOf: (item) => item.Name }), /invalid JSON/);
  await writeJsonlAtomic(file, [{ Name: "A" }, { Name: "A" }]);
  await assert.rejects(readJsonlStrict(file, { keyOf: (item) => item.Name }), /duplicate key/);
});

test("scanner excludes the root manager directory and rejects nested libraries", async (t) => {
  const root = await temporaryDirectory(t);
  await fsp.mkdir(path.join(root, ".photo_manager"));
  await fsp.writeFile(path.join(root, ".photo_manager", "cache.webp"), "cache");
  await fsp.writeFile(path.join(root, "photo.jpg"), "photo");
  const files = await walkFiles(root);
  assert.deepEqual(files.map((file) => path.basename(file)), ["photo.jpg"]);
  await fsp.mkdir(path.join(root, "nested", ".photo_manager"), { recursive: true });
  await assert.rejects(walkFiles(root), /Nested PhotoManager library/);
});

test("a directory below another library is rejected as a nested library root", async (t) => {
  const root = await temporaryDirectory(t);
  await fsp.mkdir(path.join(root, ".photo_manager"));
  const child = path.join(root, "child", "media");
  await fsp.mkdir(child, { recursive: true });
  assert.equal(findParentManagerDirectory(child), path.join(root, ".photo_manager"));
});

test("damaged images retain metadata with a failed picture probe", async (t) => {
  const root = await temporaryDirectory(t);
  const file = path.join(root, "broken.jpg");
  await fsp.writeFile(file, "not an image", "utf8");
  const item = await buildMetadata(file, root);
  assert.equal(item.FileSystem.FileType, "image");
  assert.equal(item.Picture.ProbeStatus, "failed");
  assert.equal(item.Picture.Width, null);
  assert.match(item.Picture.ProbeError, /image|unsupported|format/i);
});
