const fs = require("node:fs/promises");
const path = require("node:path");
async function rejectSymlinkPath(absolute, { allowMissing = false } = {}) {
  const resolved = path.resolve(absolute), root = path.parse(resolved).root;
  let cursor = root;
  for (const segment of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error("Symbolic links are not allowed in agent storage paths"); }
    catch (error) { if (allowMissing && error.code === "ENOENT") return; throw error; }
  }
}
module.exports = { rejectSymlinkPath };
