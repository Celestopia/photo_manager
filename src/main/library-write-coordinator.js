/** Serialize whole mutations, including validation/backup and memory publication. */
function createLibraryWriteCoordinator() {
  let tail = Promise.resolve();
  let pending = 0;
  function run(work) {
    pending += 1;
    const result = tail.then(work);
    tail = result.catch(() => {}).finally(() => { pending -= 1; });
    return result;
  }
  return { run, drain: () => tail, get busy() { return pending > 0; } };
}
module.exports = { createLibraryWriteCoordinator };
