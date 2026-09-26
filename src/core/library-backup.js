const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { DATA_FILE_NAMES, writeTextAtomic } = require("./library-core");

function safeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function listBackupSnapshots(paths) {
  if (!fs.existsSync(paths.backupDir)) return [];
  const entries = await fsp.readdir(paths.backupDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function createLibraryBackup(paths, options = {}) {
  const retentionCount = Math.max(1, Math.trunc(Number(options.retentionCount) || 10));
  const kind = options.kind || "daily";
  const reason = options.reason || "data-write";
  const now = new Date();
  if (kind === "daily") {
    const snapshots = await listBackupSnapshots(paths);
    for (const snapshot of snapshots) {
      try {
        const manifest = JSON.parse(await fsp.readFile(path.join(paths.backupDir, snapshot, "manifest.json"), "utf8"));
        if (manifest.Kind === "daily" && manifest.LocalDate === localDateKey(now)) return { created: false, directory: snapshot };
      } catch {
        // Invalid backup metadata does not block creation of a fresh snapshot.
      }
    }
  }

  await fsp.mkdir(paths.backupDir, { recursive: true });
  const directoryName = `${safeTimestamp(now)}-${kind}-${crypto.randomUUID().slice(0, 8)}`;
  const directory = path.join(paths.backupDir, directoryName);
  await fsp.mkdir(directory, { recursive: false });
  const files = [paths.manifestFile, ...Object.values(DATA_FILE_NAMES).map((name) => path.join(paths.dataDir, name))];
  try {
    for (const source of files) {
      if (fs.existsSync(source)) await fsp.copyFile(source, path.join(directory, path.basename(source)));
    }
    await writeTextAtomic(path.join(directory, "manifest.json"), `${JSON.stringify({
      CreatedAt: now.toISOString(),
      LocalDate: localDateKey(now),
      Kind: kind,
      Reason: reason,
    }, null, 2)}\n`);
  } catch (error) {
    await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Failed to create library backup: ${error.message}`);
  }

  const snapshots = await listBackupSnapshots(paths);
  for (const stale of snapshots.slice(0, Math.max(0, snapshots.length - retentionCount))) {
    await fsp.rm(path.join(paths.backupDir, stale), { recursive: true, force: true });
  }
  return { created: true, directory: directoryName };
}

module.exports = { safeTimestamp, localDateKey, listBackupSnapshots, createLibraryBackup };
