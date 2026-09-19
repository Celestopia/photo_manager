/** Shared request lifecycle for independently owned registry workflows. */
export function createRegistryRequests(manager) {
  let generation = 0;
  let latestRead = 0;
  function capture() {
    const expected = generation;
    return () => expected === generation;
  }
  async function run(operation, { read = false, ownsTarget = () => true } = {}) {
    if (manager.saving) return null;
    const current = capture();
    const request = ++latestRead;
    if (!read) manager.saving = true;
    try {
      const result = await operation();
      return current() && ownsTarget() && (!read || request === latestRead) ? result : null;
    } catch (error) {
      return current() && ownsTarget() && (!read || request === latestRead)
        ? { ok: false, error: error?.message || "Registry request failed" } : null;
    } finally {
      if (current() && !read) manager.saving = false;
    }
  }
  function reset() { generation++; latestRead++; manager.saving = false; }
  return { run, reset, capture };
}
