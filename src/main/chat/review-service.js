const { randomUUID } = require("node:crypto");
const { isCurrent, labels, same } = require("./proposals");
const { AgentError } = require("./runtime");
function createReviewService({ resolveMedia, tags, commit }) {
  async function refreshStates(session) {
    let changed = false;
    for (const p of session.proposals)
      if (
        p.status === "pending_review" &&
        !(await isCurrent(p, resolveMedia, tags()))
      ) {
        p.status = "stale";
        changed = true;
      }
    return changed;
  }
  async function decide(session, id, decision, store) {
    const p = session.proposals.find((v) => v.id === id);
    if (!p)
      throw new AgentError(
        "permission_denied",
        "Proposal not found in this conversation.",
      );
    if (!["accept", "decline", "refresh"].includes(decision))
      throw new Error("Invalid review decision");
    if (p.status === "accepted" || p.status === "declined")
      return { session, item: null };
    if (decision === "decline") {
      p.status = "declined";
      p.decidedAt = new Date().toISOString();
      await store.save(session);
      return { session, item: null };
    }
    if (decision === "refresh") {
      const found = resolveMedia(p.mediaId);
      const { fingerprint } = require("./inputs");
      if ((await fingerprint(found.absolutePath)) !== p.sha256)
        throw new AgentError(
          "resource_conflict",
          "The media changed. Ask for a new suggestion using the current file.",
        );
      const before = structuredClone(found.item.Customization[p.field]);
      const nextTags =
        p.field === "TagIds"
          ? labels([...new Set([...before, ...p.after])], tags())
          : [];
      if (same(p.field, before, p.after))
        throw new AgentError(
          "resource_conflict",
          "This value is already saved. Decline the old proposal.",
        );
      p.status = "stale";
      session.proposals.push({
        ...structuredClone(p),
        id: randomUUID(),
        before,
        tags: nextTags,
        createdAt: new Date().toISOString(),
        status: "pending_review",
        refreshOf: p.id,
      });
      await store.save(session);
      return { session, item: null };
    }
    if (p.status === "stale" || !(await isCurrent(p, resolveMedia, tags()))) {
      p.status = "stale";
      await store.save(session);
      return { session, item: null };
    }
    p.status = "accepted";
    p.decidedAt = new Date().toISOString();
    for (const other of session.proposals)
      if (
        other.id !== p.id &&
        other.status === "pending_review" &&
        other.mediaId === p.mediaId &&
        other.field === p.field
      )
        other.status = "stale";
    const item = await commit(p, session, store);
    return { session, item };
  }
  return { refreshStates, decide };
}
module.exports = { createReviewService };
