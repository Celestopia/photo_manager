const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  DATA_FILE_NAMES,
  ensureLibraryDirectories,
  readJsonlStrict,
  resolveLibraryPaths,
  writeJsonlAtomic,
  writeTextAtomic,
} = require("../scripts/library-core.js");
const {
  commitMediaDeletion,
  recoverMediaDeletionTransaction,
} = require("../scripts/media-deletion-transaction.js");
const { createMediaDeletionService } = require("../src/main/media-deletion-service.js");

const ID_A = "00000000-0000-4000-8000-000000000001";
const ID_B = "00000000-0000-4000-8000-000000000002";

async function createLibrary(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "photo-manager-delete-test-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const paths = resolveLibraryPaths(root);
  await ensureLibraryDirectories(paths);
  for (const fileName of Object.values(DATA_FILE_NAMES)) await writeJsonlAtomic(path.join(paths.dataDir, fileName), []);
  return paths;
}

function record(mediaId, filePath, hash) {
  return { MediaId: mediaId, FilePath: filePath, SHA256Hash: hash, FileSystem: { FileType: "image" } };
}

async function writeDeletionJournal(paths, item, metadataEntries) {
  const transactionId = "00000000-0000-4000-8000-000000000009";
  const directory = path.join("temp", "media-deletions", transactionId);
  const stage = path.join(directory, path.basename(item.absolutePath));
  await fsp.mkdir(path.join(paths.managerDir, directory), { recursive: true });
  await fsp.rename(item.absolutePath, path.join(paths.managerDir, stage));
  await writeJsonlAtomic(paths.metadataFile, metadataEntries);
  await writeTextAtomic(paths.mediaDeletionFile, `${JSON.stringify({
    Version: 1,
    TransactionId: transactionId,
    Reason: "test",
    CreatedAt: new Date().toISOString(),
    Phase: "staged",
    Moved: 1,
    Directory: directory,
    Media: [{ MediaId: item.MediaId, Source: path.relative(paths.root, item.absolutePath), Stage: stage }],
  })}\n`);
}

test("media deletion commits the metadata change and removes every staged file", async (t) => {
  const paths = await createLibrary(t);
  const first = record(ID_A, "a.jpg", "hash-a");
  const second = record(ID_B, "b.jpg", "hash-b");
  await fsp.writeFile(path.join(paths.root, first.FilePath), "a");
  await fsp.writeFile(path.join(paths.root, second.FilePath), "b");
  await writeJsonlAtomic(paths.metadataFile, [first, second]);

  const result = await commitMediaDeletion(paths, [
    { MediaId: ID_A, absolutePath: path.join(paths.root, first.FilePath) },
  ], [second]);

  assert.equal(result.committed, true);
  assert.equal(result.cleanupPending, false);
  assert.equal(fs.existsSync(path.join(paths.root, first.FilePath)), false);
  assert.equal(fs.existsSync(path.join(paths.root, second.FilePath)), true);
  assert.deepEqual(await readJsonlStrict(paths.metadataFile), [second]);
  assert.equal(fs.existsSync(paths.mediaDeletionFile), false);
});

test("media deletion restores earlier files when a later staging move fails", async (t) => {
  const paths = await createLibrary(t);
  const first = record(ID_A, "a.jpg", "hash-a");
  const second = record(ID_B, "missing.jpg", "hash-b");
  const firstPath = path.join(paths.root, first.FilePath);
  await fsp.writeFile(firstPath, "a");
  await writeJsonlAtomic(paths.metadataFile, [first, second]);

  await assert.rejects(commitMediaDeletion(paths, [
    { MediaId: ID_A, absolutePath: firstPath },
    { MediaId: ID_B, absolutePath: path.join(paths.root, second.FilePath) },
  ], []));

  assert.equal(await fsp.readFile(firstPath, "utf8"), "a");
  assert.deepEqual(await readJsonlStrict(paths.metadataFile), [first, second]);
  assert.equal(fs.existsSync(paths.mediaDeletionFile), false);
});

test("recovery restores staged files when metadata still contains the records", async (t) => {
  const paths = await createLibrary(t);
  const item = record(ID_A, "a.jpg", "hash-a");
  const absolutePath = path.join(paths.root, item.FilePath);
  await fsp.writeFile(absolutePath, "a");
  await writeDeletionJournal(paths, { MediaId: ID_A, absolutePath }, [item]);

  assert.deepEqual(await recoverMediaDeletionTransaction(paths), { recovered: true, action: "rolled-back", reason: "test" });
  assert.equal(await fsp.readFile(absolutePath, "utf8"), "a");
  assert.equal(fs.existsSync(paths.mediaDeletionFile), false);
});

test("recovery finalizes staged files when metadata no longer contains the records", async (t) => {
  const paths = await createLibrary(t);
  const absolutePath = path.join(paths.root, "a.jpg");
  await fsp.writeFile(absolutePath, "a");
  await writeDeletionJournal(paths, { MediaId: ID_A, absolutePath }, []);

  assert.deepEqual(await recoverMediaDeletionTransaction(paths), { recovered: true, action: "finalized", reason: "test" });
  assert.equal(fs.existsSync(absolutePath), false);
  assert.equal(fs.existsSync(paths.mediaDeletionFile), false);
});

test("deletion service keeps a thumbnail shared by a remaining content hash", async (t) => {
  const paths = await createLibrary(t);
  const first = record(ID_A, "a.jpg", "shared-hash");
  const second = record(ID_B, "b.jpg", "shared-hash");
  const metadata = new Map([[ID_A, first], [ID_B, second]]);
  const byPath = new Map([[first.FilePath, ID_A], [second.FilePath, ID_B]]);
  await fsp.writeFile(path.join(paths.root, first.FilePath), "a");
  await fsp.writeFile(path.join(paths.root, second.FilePath), "b");
  const thumbnail = path.join(paths.thumbnailDir, "shared-hash.webp");
  await fsp.writeFile(thumbnail, "thumb");
  await writeJsonlAtomic(paths.metadataFile, [...metadata.values()]);
  let backupCreated = false;
  const service = createMediaDeletionService({
    getMetadata: () => metadata,
    getMediaPathIndex: () => byPath,
    requireOpenLibrary: () => ({ paths }),
    resolveIndexedMediaPath: (mediaId) => ({ item: metadata.get(mediaId), absolutePath: path.join(paths.root, metadata.get(mediaId).FilePath) }),
    prepareLibraryWrite: async () => { backupCreated = true; },
    commitDeletion: commitMediaDeletion,
    thumbnailAbsolutePath: (directory, hash) => path.join(directory, `${hash}.webp`),
    clearThumbnailStatusCache: () => {},
    touchLibraryManifest: async () => {},
    emitLibraryState: () => {},
    stopChat: async () => {},
    appendLog: () => {},
  });

  const result = await service.deleteMedia({ mediaIds: [ID_A] });
  assert.equal(result.ok, true);
  assert.equal(backupCreated, true);
  assert.equal(metadata.has(ID_A), false);
  assert.equal(byPath.has(first.FilePath), false);
  assert.equal(fs.existsSync(thumbnail), true);
});
