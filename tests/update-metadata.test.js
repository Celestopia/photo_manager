const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isUnchangedRecord,
  preserveUserFields,
  cloneMovedRecord,
  synchronizeMetadata,
} = require("../scripts/update-metadata");

function snapshot() {
  return {
    relativePath: "new/video.mp4",
    ext: ".mp4",
    type: "video",
    stat: { size: 1000, mtimeMs: 12345 },
    creation: { text: "2026-01-01 00:00:00", zone: 8, stamp: 1 },
    modified: { text: "2026-01-02 00:00:00", zone: 8, stamp: 2 },
  };
}

test("unchanged detection requires type, size, and millisecond mtime", () => {
  const item = { FileSystem: { FileType: "video", FileSize: 1000, ModificationTimeMs: 12345 } };
  assert.equal(isUnchangedRecord(item, snapshot()), true);
  assert.equal(isUnchangedRecord({ FileSystem: { ...item.FileSystem, ModificationTimeMs: 12346 } }, snapshot()), false);
  assert.equal(isUnchangedRecord({ FileSystem: { FileType: "video", FileSize: 1000 } }, snapshot()), false);
});

test("rebuilt records preserve user-authored customization and location", () => {
  const built = { Customization: { Title: "" }, Location: { Place: "" } };
  const old = { Customization: { Title: "Saved", Category: "legacy" }, Location: { Place: "Beijing", Detail: "A" } };
  const result = preserveUserFields(built, old);
  assert.equal(result.Customization.Title, "Saved");
  assert.equal(Object.hasOwn(result.Customization, "Category"), false);
  assert.deepEqual(result.Location, { Place: "Beijing", Detail: "A" });
});

test("moved records retain media metadata while refreshing path and file stats", () => {
  const old = {
    FilePath: "old/video.mp4",
    SHA256Hash: "hash",
    FileSystem: { FileType: "video", ShootingTimeString: "2025-01-01 10:00:00" },
    Video: { DurationSeconds: 10 },
    Customization: { Title: "Saved" },
  };
  const moved = cloneMovedRecord(old, snapshot(), "hash");
  assert.equal(moved.FilePath, "new/video.mp4");
  assert.equal(moved.FileSystem.ModificationTimeMs, 12345);
  assert.equal(moved.FileSystem.ShootingTimeString, "2025-01-01 10:00:00");
  assert.equal(moved.Video.DurationSeconds, 10);
  assert.equal(moved.Customization.Title, "Saved");
});

function quietLogger() {
  return { warn() {} };
}

test("incremental sync reuses unchanged records without hashing or probing", async () => {
  const current = {
    FilePath: "new/video.mp4",
    SHA256Hash: "same",
    FileSystem: { FileType: "video", FileSize: 1000, ModificationTimeMs: 12345 },
  };
  let expensiveCalls = 0;
  const result = await synchronizeMetadata({
    config: { media: {} },
    root: "C:\\library",
    existing: new Map([[current.FilePath, current]]),
    files: ["C:\\library\\new\\video.mp4"],
    logger: quietLogger(),
    dependencies: {
      inspectMediaFile: async (filePath) => ({ ...snapshot(), filePath }),
      sha256File: async () => { expensiveCalls += 1; return "same"; },
      buildMetadata: async () => { expensiveCalls += 1; return {}; },
    },
  });
  assert.equal(expensiveCalls, 0);
  assert.equal(result.stats.reused, 1);
  assert.equal(result.next.get(current.FilePath), current);
});

test("incremental sync treats a missing old path with the same hash as a move", async () => {
  const old = {
    FilePath: "old/video.mp4",
    SHA256Hash: "same",
    FileSystem: { FileType: "video", FileSize: 1000, ModificationTimeMs: 12345 },
    Video: { DurationSeconds: 10 },
    Customization: { Title: "Moved title" },
  };
  const result = await synchronizeMetadata({
    config: { media: {} },
    root: "C:\\library",
    existing: new Map([[old.FilePath, old]]),
    files: ["C:\\library\\new\\video.mp4"],
    logger: quietLogger(),
    dependencies: {
      inspectMediaFile: async (filePath) => ({ ...snapshot(), filePath }),
      sha256File: async () => "same",
      buildMetadata: async () => { throw new Error("move should not be reprobed"); },
    },
  });
  assert.equal(result.stats.moved, 1);
  assert.equal(result.next.get("new/video.mp4").Customization.Title, "Moved title");
});

test("incremental sync does not inherit customization for a live duplicate", async () => {
  const old = {
    FilePath: "old/video.mp4",
    SHA256Hash: "same",
    FileSystem: { FileType: "video", FileSize: 1000, ModificationTimeMs: 12345 },
    Customization: { Title: "Original title" },
  };
  const snapshots = {
    "C:\\library\\old\\video.mp4": { ...snapshot(), relativePath: "old/video.mp4" },
    "C:\\library\\new\\video.mp4": { ...snapshot(), relativePath: "new/video.mp4" },
  };
  const result = await synchronizeMetadata({
    config: { media: {} },
    root: "C:\\library",
    existing: new Map([[old.FilePath, old]]),
    files: Object.keys(snapshots),
    logger: quietLogger(),
    dependencies: {
      inspectMediaFile: async (filePath) => ({ ...snapshots[filePath], filePath }),
      sha256File: async () => "same",
      buildMetadata: async (_filePath, _root, options) => ({
        FilePath: options.snapshot.relativePath,
        SHA256Hash: options.hash,
        FileSystem: { FileType: "video" },
        Customization: { Title: "" },
        Location: { Place: "", Detail: "" },
      }),
    },
  });
  assert.equal(result.stats.reused, 1);
  assert.equal(result.stats.rebuilt, 1);
  assert.equal(result.next.get("new/video.mp4").Customization.Title, "");
});

test("incremental sync does not reuse technical metadata across media types", async () => {
  const oldImage = {
    FilePath: "old/file.jpg",
    SHA256Hash: "same",
    FileSystem: { FileType: "image", FileSize: 1000, ModificationTimeMs: 12345 },
    Picture: { Width: 100, Height: 100 },
    Customization: { Title: "Old image" },
  };
  const result = await synchronizeMetadata({
    config: { media: {} },
    root: "C:\\library",
    existing: new Map([[oldImage.FilePath, oldImage]]),
    files: ["C:\\library\\new\\video.mp4"],
    logger: quietLogger(),
    dependencies: {
      inspectMediaFile: async (filePath) => ({ ...snapshot(), filePath }),
      sha256File: async () => "same",
      buildMetadata: async (_filePath, _root, options) => ({
        FilePath: options.snapshot.relativePath,
        SHA256Hash: options.hash,
        FileSystem: { FileType: "video" },
        Video: { ProbeStatus: "ok" },
        Customization: { Title: "" },
        Location: { Place: "", Detail: "" },
      }),
    },
  });
  assert.equal(result.stats.moved, 0);
  assert.equal(result.stats.rebuilt, 1);
  assert.equal(result.next.get("new/video.mp4").Video.ProbeStatus, "ok");
  assert.equal(result.next.get("new/video.mp4").Picture, undefined);
});

test("incremental sync retains direct metadata after a temporary rebuild failure", async () => {
  const current = {
    FilePath: "new/video.mp4",
    SHA256Hash: "old",
    FileSystem: { FileType: "video", FileSize: 999, ModificationTimeMs: 1 },
    Customization: { Title: "Keep me" },
  };
  const result = await synchronizeMetadata({
    config: { media: {} },
    root: "C:\\library",
    existing: new Map([[current.FilePath, current]]),
    files: ["C:\\library\\new\\video.mp4"],
    logger: quietLogger(),
    dependencies: {
      inspectMediaFile: async (filePath) => ({ ...snapshot(), filePath }),
      buildMetadata: async () => { throw new Error("temporary read failure"); },
    },
  });
  assert.equal(result.stats.failed, 1);
  assert.equal(result.next.get(current.FilePath), current);
});
