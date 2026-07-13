/** Recoverable multi-file commits for library-owned JSONL data. */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { writeTextAtomic } = require("./library-core");

const TRANSACTION_VERSION = 1;

function serializeJsonl(entries) {
  const lines = [...entries].map((entry) => JSON.stringify(entry));
  return `${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

function resolveTransactionPath(paths, relativePath) {
  const absolute = path.resolve(paths.managerDir, String(relativePath || ""));
  const relative = path.relative(paths.managerDir, absolute);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Transaction target escapes the library manager directory");
  }
  return absolute;
}

async function removeTransactionArtifacts(paths, journal) {
  // Remove the journal first after data is consistent. An orphaned temp
  // directory is harmless; an orphaned journal without rollback files is not.
  await fsp.rm(paths.transactionFile, { force: true });
  if (journal?.Directory) {
    const directory = resolveTransactionPath(paths, journal.Directory);
    await fsp.rm(directory, { recursive: true, force: true });
  }
}

async function readTransactionJournal(paths) {
  if (!fs.existsSync(paths.transactionFile)) return null;
  let journal;
  try {
    journal = JSON.parse(await fsp.readFile(paths.transactionFile, "utf8"));
  } catch (error) {
    throw new Error(`Cannot recover library transaction: ${error.message}`);
  }
  if (journal?.Version !== TRANSACTION_VERSION || !Array.isArray(journal?.Targets)) {
    throw new Error("Cannot recover library transaction: invalid transaction journal");
  }
  return journal;
}

async function recoverPendingTransaction(paths) {
  const journal = await readTransactionJournal(paths);
  if (!journal) return { recovered: false };
  const applied = Math.max(0, Math.trunc(Number(journal.Applied) || 0));
  if (journal.Phase === "committed" || applied >= journal.Targets.length) {
    await removeTransactionArtifacts(paths, journal);
    return { recovered: true, action: "finalized", reason: journal.Reason || "" };
  }

  for (const target of journal.Targets) {
    const destination = resolveTransactionPath(paths, target.Path);
    if (target.Existed) {
      const backup = resolveTransactionPath(paths, target.Backup);
      if (!fs.existsSync(backup)) throw new Error(`Cannot recover library transaction: missing rollback file for ${target.Path}`);
      await writeTextAtomic(destination, await fsp.readFile(backup, "utf8"));
    } else {
      await fsp.rm(destination, { force: true });
    }
  }
  await removeTransactionArtifacts(paths, journal);
  return { recovered: true, action: "rolled-back", reason: journal.Reason || "" };
}

async function commitTextTransaction(paths, changes, options = {}) {
  if (!Array.isArray(changes) || changes.length === 0) return { committed: false };
  if (fs.existsSync(paths.transactionFile)) {
    throw new Error("A pending library transaction must be recovered before writing");
  }

  const transactionId = crypto.randomUUID();
  const directoryRelative = path.join("temp", "transactions", transactionId);
  const directory = resolveTransactionPath(paths, directoryRelative);
  await fsp.mkdir(directory, { recursive: true });
  const targets = [];
  try {
    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index];
      const destination = path.resolve(change.filePath);
      const relative = path.relative(paths.managerDir, destination);
      resolveTransactionPath(paths, relative);
      const stageRelative = path.join(directoryRelative, `${index}.next`);
      const backupRelative = path.join(directoryRelative, `${index}.previous`);
      const stage = resolveTransactionPath(paths, stageRelative);
      const backup = resolveTransactionPath(paths, backupRelative);
      const existed = fs.existsSync(destination);
      await fsp.writeFile(stage, String(change.text ?? ""), "utf8");
      if (existed) await fsp.copyFile(destination, backup);
      targets.push({ Path: relative, Stage: stageRelative, Backup: backupRelative, Existed: existed });
    }

    const journal = {
      Version: TRANSACTION_VERSION,
      TransactionId: transactionId,
      Reason: String(options.reason || "library-data-write"),
      CreatedAt: new Date().toISOString(),
      Phase: "prepared",
      Applied: 0,
      Directory: directoryRelative,
      Targets: targets,
    };
    await writeTextAtomic(paths.transactionFile, `${JSON.stringify(journal, null, 2)}\n`);

    for (let index = 0; index < targets.length; index += 1) {
      await options.beforeApply?.(index, targets[index]);
      const target = targets[index];
      await writeTextAtomic(
        resolveTransactionPath(paths, target.Path),
        await fsp.readFile(resolveTransactionPath(paths, target.Stage), "utf8"),
      );
      journal.Applied = index + 1;
      await writeTextAtomic(paths.transactionFile, `${JSON.stringify(journal, null, 2)}\n`);
    }
    journal.Phase = "committed";
    await writeTextAtomic(paths.transactionFile, `${JSON.stringify(journal, null, 2)}\n`);
    await removeTransactionArtifacts(paths, journal);
    return { committed: true, transactionId };
  } catch (error) {
    if (fs.existsSync(paths.transactionFile)) {
      try {
        const recovery = await recoverPendingTransaction(paths);
        if (recovery.action === "finalized") {
          return { committed: true, transactionId, recovered: true };
        }
      } catch (recoveryError) {
        error.message = `${error.message}; rollback failed: ${recoveryError.message}`;
      }
    } else {
      await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }
}

async function commitJsonlTransaction(paths, changes, options = {}) {
  return commitTextTransaction(
    paths,
    changes.map((change) => ({ filePath: change.filePath, text: serializeJsonl(change.entries) })),
    options,
  );
}

module.exports = {
  TRANSACTION_VERSION,
  serializeJsonl,
  readTransactionJournal,
  recoverPendingTransaction,
  commitTextTransaction,
  commitJsonlTransaction,
};
