/** Recoverable, all-or-nothing commits spanning media files and metadata. */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { assertPathInsideLibrary, readJsonlStrict, writeJsonlAtomic, writeTextAtomic } = require("./library-core.js");
const { assertUuidV4 } = require("../src/shared/identity-schema.js");
const { assertExactObjectKeys } = require("../src/shared/object-schema.js");

const MEDIA_DELETION_VERSION = 1;

function resolveManagerPath(paths, relativePath) {
  const absolute = path.resolve(paths.managerDir, String(relativePath || ""));
  const relative = path.relative(paths.managerDir, absolute);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Media deletion staging path escapes the library manager directory");
  }
  return absolute;
}

function resolveMediaPath(paths, relativePath) {
  return assertPathInsideLibrary(paths, path.resolve(paths.root, String(relativePath || "")));
}

function validateJournal(paths, journal) {
  if (!journal || journal.Version !== MEDIA_DELETION_VERSION || !Array.isArray(journal.Media)) {
    throw new Error("Cannot recover media deletion: invalid journal");
  }
  assertExactObjectKeys(journal, ["Version", "TransactionId", "Reason", "CreatedAt", "Phase", "Moved", "Directory", "Media"], "Media deletion journal");
  assertUuidV4(journal.TransactionId, "Media deletion TransactionId");
  if (typeof journal.Reason !== "string" || !Number.isFinite(Date.parse(journal.CreatedAt))) throw new Error("Cannot recover media deletion: invalid journal details");
  if (!["staging", "staged", "metadata-committed"].includes(journal.Phase)) throw new Error("Cannot recover media deletion: invalid journal phase");
  if (!journal.Media.length) throw new Error("Cannot recover media deletion: empty journal");
  if (!Number.isInteger(journal.Moved) || journal.Moved < 0 || journal.Moved > journal.Media.length) throw new Error("Cannot recover media deletion: invalid moved count");
  const expectedDirectory = path.join("temp", "media-deletions", journal.TransactionId);
  if (path.normalize(journal.Directory) !== expectedDirectory) throw new Error("Cannot recover media deletion: invalid staging directory");
  const directory = resolveManagerPath(paths, journal.Directory);
  for (const item of journal.Media) {
    assertExactObjectKeys(item, ["MediaId", "Source", "Stage"], "Media deletion journal entry");
    assertUuidV4(item.MediaId, "Media deletion MediaId");
    if (!item.Source || !item.Stage) throw new Error("Cannot recover media deletion: invalid media entry");
    resolveMediaPath(paths, item.Source);
    const stage = resolveManagerPath(paths, item.Stage);
    const stageRelative = path.relative(directory, stage);
    if (!stageRelative || stageRelative === ".." || stageRelative.startsWith(`..${path.sep}`) || path.isAbsolute(stageRelative)) {
      throw new Error("Cannot recover media deletion: invalid staged media path");
    }
  }
  return journal;
}

async function readMediaDeletionJournal(paths) {
  if (!fs.existsSync(paths.mediaDeletionFile)) return null;
  try {
    return validateJournal(paths, JSON.parse(await fsp.readFile(paths.mediaDeletionFile, "utf8")));
  } catch (error) {
    if (error.message.startsWith("Cannot recover media deletion:")) throw error;
    throw new Error(`Cannot recover media deletion: ${error.message}`);
  }
}

async function writeJournal(paths, journal) {
  await writeTextAtomic(paths.mediaDeletionFile, `${JSON.stringify(journal, null, 2)}\n`);
}

async function rollbackStagedFiles(paths, journal) {
  for (let index = journal.Media.length - 1; index >= 0; index -= 1) {
    const item = journal.Media[index];
    const source = resolveMediaPath(paths, item.Source);
    const stage = resolveManagerPath(paths, item.Stage);
    const sourceExists = fs.existsSync(source);
    const stageExists = fs.existsSync(stage);
    if (sourceExists && stageExists) throw new Error(`Cannot restore ${item.Source}: both source and staged files exist`);
    if (!sourceExists && !stageExists && (journal.Phase !== "staging" || index < journal.Moved)) {
      throw new Error(`Cannot restore ${item.Source}: both source and staged files are missing`);
    }
    if (stageExists) {
      await fsp.mkdir(path.dirname(source), { recursive: true });
      await fsp.rename(stage, source);
    }
  }
  await fsp.rm(paths.mediaDeletionFile, { force: true });
  await fsp.rm(resolveManagerPath(paths, journal.Directory), { recursive: true, force: true });
}

async function finalizeStagedFiles(paths, journal) {
  await fsp.rm(resolveManagerPath(paths, journal.Directory), { recursive: true, force: true });
  await fsp.rm(paths.mediaDeletionFile, { force: true });
}

async function metadataPresence(paths, journal) {
  const entries = await readJsonlStrict(paths.metadataFile, {
    keyOf: (item) => item.MediaId,
    label: "photo_metadata.jsonl",
  });
  const ids = new Set(entries.map((item) => item.MediaId));
  const presence = journal.Media.map((item) => ids.has(item.MediaId));
  if (presence.every(Boolean)) return "present";
  if (presence.every((value) => !value)) return "absent";
  throw new Error("Cannot recover media deletion: metadata contains only part of the deletion set");
}

async function recoverMediaDeletionTransaction(paths) {
  const journal = await readMediaDeletionJournal(paths);
  if (!journal) return { recovered: false };
  const presence = await metadataPresence(paths, journal);
  if (presence === "present") {
    await rollbackStagedFiles(paths, journal);
    return { recovered: true, action: "rolled-back", reason: journal.Reason || "" };
  }
  await finalizeStagedFiles(paths, journal);
  return { recovered: true, action: "finalized", reason: journal.Reason || "" };
}

async function commitMediaDeletion(paths, media, remainingEntries, options = {}) {
  if (!Array.isArray(media) || !media.length) throw new Error("No media files were supplied for deletion");
  if (fs.existsSync(paths.mediaDeletionFile)) throw new Error("A pending media deletion must be recovered before writing");

  const transactionId = crypto.randomUUID();
  const directoryRelative = path.join("temp", "media-deletions", transactionId);
  const directory = resolveManagerPath(paths, directoryRelative);
  await fsp.mkdir(directory, { recursive: true });
  const journal = {
    Version: MEDIA_DELETION_VERSION,
    TransactionId: transactionId,
    Reason: String(options.reason || "media-delete"),
    CreatedAt: new Date().toISOString(),
    Phase: "staging",
    Moved: 0,
    Directory: directoryRelative,
    Media: media.map((item, index) => ({
      MediaId: item.MediaId,
      Source: path.relative(paths.root, assertPathInsideLibrary(paths, item.absolutePath)),
      Stage: path.join(directoryRelative, `${index}-${path.basename(item.absolutePath)}`),
    })),
  };

  try {
    await writeJournal(paths, journal);
    for (let index = 0; index < journal.Media.length; index += 1) {
      const item = journal.Media[index];
      await fsp.rename(resolveMediaPath(paths, item.Source), resolveManagerPath(paths, item.Stage));
      journal.Moved = index + 1;
      await writeJournal(paths, journal);
    }
    journal.Phase = "staged";
    await writeJournal(paths, journal);
    await writeJsonlAtomic(paths.metadataFile, remainingEntries);
    journal.Phase = "metadata-committed";
    await writeJournal(paths, journal);
  } catch (error) {
    if (fs.existsSync(paths.mediaDeletionFile)) {
      try {
        const recovery = await recoverMediaDeletionTransaction(paths);
        if (recovery.action === "finalized") return { committed: true, transactionId, recovered: true, cleanupPending: false };
      } catch (recoveryError) {
        error.message = `${error.message}; recovery failed: ${recoveryError.message}`;
      }
    } else {
      await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }

  try {
    await finalizeStagedFiles(paths, journal);
    return { committed: true, transactionId, cleanupPending: false };
  } catch (error) {
    options.onCleanupError?.(error);
    return { committed: true, transactionId, cleanupPending: true };
  }
}

module.exports = {
  MEDIA_DELETION_VERSION,
  readMediaDeletionJournal,
  recoverMediaDeletionTransaction,
  commitMediaDeletion,
};
