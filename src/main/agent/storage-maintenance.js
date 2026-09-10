const fs = require("node:fs/promises");
const path = require("node:path");
const { rejectSymlinkPath } = require("./path-safety");
const { validateReceipt } = require("./operation-store");
const { assertUuidV4 } = require("../../shared/agent-schema");

/** Call only after transaction recovery while holding the library's exclusive lock. */
async function expireReceipts(paths, libraryId, now = Date.now()) {
  await rejectSymlinkPath(paths.agentOperationsDir, { allowMissing: true });
  const entries = await fs.readdir(paths.agentOperationsDir, { withFileTypes: true }).catch(error => { if (error.code === "ENOENT") return []; throw error; });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) throw new Error("Invalid operation receipt entry");
    assertUuidV4(entry.name.slice(0, -5));
    const file = path.join(paths.agentOperationsDir, entry.name), receipt = validateReceipt(JSON.parse(await fs.readFile(file, "utf8")));
    if (receipt.libraryId !== libraryId || receipt.operationId + '.json' !== entry.name) throw new Error("Operation receipt identity mismatch");
    if (Date.parse(receipt.expiresAt) <= now) { await fs.unlink(file); removed++; }
  }
  return removed;
}

/** Runs after a foreground build has finished; no vector reader may be active. */
async function pruneGenerations(paths, keep) {
  const root = path.resolve(paths.agentIndexDir, "generations");
  await rejectSymlinkPath(root, { allowMissing: true });
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(error => { if (error.code === "ENOENT") return []; throw error; });
  for (const entry of entries) {
    assertUuidV4(entry.name);
    if (keep.has(entry.name)) continue;
    const target = path.resolve(root, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink() || path.dirname(target) !== root) throw new Error("Invalid index generation directory");
    await fs.rm(target, { recursive: true, force: true });
  }
}
module.exports = { expireReceipts, pruneGenerations };
