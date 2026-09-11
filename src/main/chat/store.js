const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { writeTextAtomic } = require("../../../scripts/library-core");
const { id, assertSession } = require("./schema");

async function safePath(root, ...parts) {
  const absolute = path.resolve(root, ...parts);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Chat path escapes its storage folder");
  // Check every ancestor, including the library root, for links/junctions.
  let current = path.parse(absolute).root;
  for (const segment of absolute
    .slice(current.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch((e) => {
      if (e.code !== "ENOENT") throw e;
      return null;
    });
    if (stat?.isSymbolicLink())
      throw new Error("Symbolic links are not allowed in chat storage");
  }
  return absolute;
}
async function safeRemove(root, target) {
  target = await safePath(root, path.relative(root, target));
  if (target === path.resolve(root))
    throw new Error("Refusing to delete chat storage root");
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const child = await safePath(
        root,
        path.relative(root, path.join(dir, entry.name)),
      );
      if (entry.isDirectory()) await walk(child);
    }
  }
  await walk(target);
  await fs.rm(target, { recursive: true, force: true });
}
function createStore(library) {
  const root = path.join(library.paths.managerDir, "chat");
  const libraryId = library.manifest.libraryId;
  const file = async (sid) =>
    safePath(root, "sessions", id(sid), "session.json");
  async function save(s) {
    assertSession(s, libraryId);
    s.updatedAt = new Date().toISOString();
    await writeTextAtomic(
      await file(s.sessionId),
      JSON.stringify(s, null, 2) + "\n",
    );
    return s;
  }
  async function load(sid) {
    return assertSession(
      JSON.parse(await fs.readFile(await file(sid), "utf8")),
      libraryId,
    );
  }
  async function create() {
    const now = new Date().toISOString();
    return save({
      schemaVersion: 1,
      sessionId: randomUUID(),
      libraryId,
      title: "New conversation",
      createdAt: now,
      updatedAt: now,
      messages: [],
      attachments: [],
    });
  }
  async function list(includeDrafts = false) {
    const dir = await safePath(root, "sessions");
    const entries = await fs
      .readdir(dir, { withFileTypes: true })
      .catch((e) => {
        if (e.code === "ENOENT") return [];
        throw e;
      });
    const result = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const s = await load(entry.name);
        if (!includeDrafts && !s.messages.some(m => m.role === "user")) continue;
        result.push({
          sessionId: s.sessionId,
          title: s.title,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          excerpt:
            s.messages.find((m) => m.role === "user")?.text.slice(0, 120) || "",
          mediaIds: [
            ...new Set(
              s.messages.flatMap((m) =>
                m.inputs.filter((i) => i.kind === "media").map((i) => i.id),
              ),
            ),
          ],
          error: "",
        });
      } catch {
        result.push({
          sessionId: entry.name,
          title: "Unreadable conversation",
          error:
            "This conversation is corrupt or unavailable. Its files were left untouched.",
        });
      }
    }
    return result.sort((a, b) =>
      (b.updatedAt || "").localeCompare(a.updatedAt || ""),
    );
  }
  async function attachmentPath(s, aid) {
    const a = s.attachments.find((a) => a.id === id(aid));
    if (!a) throw new Error("Attachment unavailable");
    return safePath(
      root,
      "sessions",
      s.sessionId,
      "attachments",
      `${a.id}.${a.extension}`,
    );
  }
  async function remove(sid) {
    const source = await safePath(root, "sessions", id(sid));
    const target = await safePath(root, "trash", sid);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(source, target);
    try {
      await safeRemove(root, target);
      return { pending: false };
    } catch {
      return { pending: true };
    }
  }
  async function recover() {
    const trash = await safePath(root, "trash");
    const pending = [];
    for (const entry of await fs.readdir(trash).catch((e) => {
      if (e.code === "ENOENT") return [];
      throw e;
    })) {
      try {
        id(entry);
        await safeRemove(root, path.join(trash, entry));
      } catch {
        pending.push(entry);
      }
    }
    for (const row of await list(true)) {
      if (row.error) continue;
      const s = await load(row.sessionId);
      let changed = false;
      for (const m of s.messages)
        if (["pending", "streaming"].includes(m.status)) {
          m.status = "interrupted";
          changed = true;
        }
      if (changed) await save(s);
      const dir = await safePath(root, "sessions", s.sessionId, "attachments");
      const owned = new Set(s.attachments.map((a) => `${a.id}.${a.extension}`));
      for (const name of await fs.readdir(dir).catch((e) => {
        if (e.code === "ENOENT") return [];
        throw e;
      })) {
        if (!owned.has(name)) {
          const candidate = await safePath(
            root,
            "sessions",
            s.sessionId,
            "attachments",
            name,
          );
          if ((await fs.lstat(candidate)).isFile()) await fs.unlink(candidate);
        }
      }
    }
    pending.push(...await cleanEmpty());
    return pending;
  }
  async function cleanEmpty() {
    const pending = [];
    for (const row of await list(true))
      if (!row.error) {
        const s = await load(row.sessionId);
        if (!s.messages.length) {
          const result = await remove(s.sessionId);
          if (result.pending) pending.push(s.sessionId);
        }
      }
    return pending;
  }
  return {
    root,
    libraryId,
    save,
    load,
    create,
    list,
    attachmentPath,
    remove,
    recover,
    cleanEmpty,
  };
}
module.exports = { createStore, safePath, safeRemove };
