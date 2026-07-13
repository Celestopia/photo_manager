const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fsp = require("node:fs/promises");
const {
  resolveLibraryPaths,
  createLibraryManifest,
  ensureLibraryDirectories,
  writeLibraryManifest,
  writeJsonlAtomic,
  DATA_FILE_NAMES,
} = require("../scripts/library-core");
const { acquireLibraryLock, inspectLibraryLock, releaseLibraryLock } = require("../scripts/library-lock");
const { createLibraryBackup, listBackupSnapshots } = require("../scripts/library-backup");
const { commitJsonlTransaction } = require("../scripts/library-transaction");

async function createLibrary(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "photo-manager-lock-test-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const paths = resolveLibraryPaths(root);
  await ensureLibraryDirectories(paths);
  const manifest = createLibraryManifest(root, "Lock Test");
  await writeLibraryManifest(paths, manifest);
  for (const fileName of Object.values(DATA_FILE_NAMES)) await writeJsonlAtomic(path.join(paths.dataDir, fileName), []);
  return { paths, manifest };
}

test("library lock is exclusive and only its owning session releases it", async (t) => {
  const { paths, manifest } = await createLibrary(t);
  const lock = await acquireLibraryLock(paths, manifest);
  const state = await inspectLibraryLock(paths);
  assert.equal(state.exists, true);
  assert.equal(state.active, true);
  await assert.rejects(acquireLibraryLock(paths, manifest), /Library is locked/);
  await assert.rejects(acquireLibraryLock(paths, manifest, { force: true }), /active library lock/i);
  assert.equal(await releaseLibraryLock(paths, "wrong-session"), false);
  assert.equal(await releaseLibraryLock(paths, lock.SessionId), true);
});

test("backup retention is counted by snapshot directory", async (t) => {
  const { paths } = await createLibrary(t);
  for (let index = 0; index < 4; index += 1) {
    await createLibraryBackup(paths, { kind: `test-${index}`, reason: "test", retentionCount: 2 });
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal((await listBackupSnapshots(paths)).length, 2);
});

test("multi-file JSONL transactions roll back every target after a partial commit", async (t) => {
  const { paths } = await createLibrary(t);
  const tagsFile = path.join(paths.dataDir, DATA_FILE_NAMES.tags);
  const metadataFile = path.join(paths.dataDir, DATA_FILE_NAMES.metadata);
  await writeJsonlAtomic(tagsFile, [{ Text: "before" }]);
  await writeJsonlAtomic(metadataFile, [{ FilePath: "before.jpg" }]);

  await assert.rejects(commitJsonlTransaction(paths, [
    { filePath: tagsFile, entries: [{ Text: "after" }] },
    { filePath: metadataFile, entries: [{ FilePath: "after.jpg" }] },
  ], {
    reason: "test-partial-write",
    beforeApply: async (index) => {
      if (index === 1) throw new Error("simulated write failure");
    },
  }), /simulated write failure/);

  assert.deepEqual(JSON.parse((await fsp.readFile(tagsFile, "utf8")).trim()), { Text: "before" });
  assert.deepEqual(JSON.parse((await fsp.readFile(metadataFile, "utf8")).trim()), { FilePath: "before.jpg" });
  await assert.rejects(fsp.access(paths.transactionFile));
});
