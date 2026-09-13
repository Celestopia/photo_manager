const fs = require("node:fs");

/** One queue per window/library. Never hold it around model/network generation. */
function createMutationCoordinator() {
  let tail = Promise.resolve();
  return (operation) => {
    const task = tail.then(operation);
    tail = task.catch(() => {});
    return task;
  };
}

function assertMutationReady(library) {
  if (fs.existsSync(library.paths.transactionFile)) {
    const error = new Error(
      "Reopen the library to recover its pending transaction before making changes.",
    );
    error.code = "RECOVERY_REQUIRED";
    throw error;
  }
}
module.exports = { createMutationCoordinator, assertMutationReady };
