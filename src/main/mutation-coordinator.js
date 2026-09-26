const { assertLibraryReady } = require("../core/library-recovery");

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
  assertLibraryReady(library.paths);
}
module.exports = { createMutationCoordinator, assertMutationReady };
