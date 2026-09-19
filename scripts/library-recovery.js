/** Shared readiness policy. Recovery requires the caller to own the library lock. */
const fs = require("node:fs");
const { recoverMediaDeletionTransaction } = require("./media-deletion-transaction");
const { recoverPendingTransaction } = require("./library-transaction");

function assertLibraryReady(paths) {
  if (fs.existsSync(paths.mediaDeletionFile) || fs.existsSync(paths.transactionFile)) {
    const error = new Error("Reopen the library to recover its pending transaction before continuing.");
    error.code = "RECOVERY_REQUIRED";
    throw error;
  }
}

async function recoverLibraryTransactions(paths, report = () => {}) {
  // Deletion interprets metadata presence, so it must run before other writers.
  const deletion = await recoverMediaDeletionTransaction(paths);
  if (deletion.recovered) report(`media-deletion ${deletion.action} reason=${deletion.reason || "unknown"}`);
  const transaction = await recoverPendingTransaction(paths);
  if (transaction.recovered) report(`library-transaction ${transaction.action} reason=${transaction.reason || "unknown"}`);
  if (transaction.cleanupPending) report(`Transaction committed; temporary cleanup pending: ${transaction.cleanupError}`);
  assertLibraryReady(paths);
  return { deletion, transaction };
}

module.exports = { assertLibraryReady, recoverLibraryTransactions };
