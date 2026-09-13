const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { exact, uuid, str, AgentError } = require("./runtime");
const { fingerprint } = require("./inputs");
const {
  assertCustomizationPatch,
} = require("../../shared/customization-schema");
const same = (field, a, b) =>
  JSON.stringify(field === "TagIds" ? [...a].sort() : a) ===
  JSON.stringify(field === "TagIds" ? [...b].sort() : b);
function labels(ids, tags) {
  return ids.map((id) => {
    const t = tags.find((t) => t.TagId === id);
    if (!t)
      throw new AgentError(
        "resource_conflict",
        "A tag is no longer registered. Look up existing tags again.",
      );
    return { TagId: id, Text: t.Text };
  });
}
async function prepareProposal({
  session,
  scope,
  field,
  args,
  call,
  resolveMedia,
  tags,
  budget,
  signal,
}) {
  const found = resolveMedia(args.mediaId),
    before = structuredClone(found.item.Customization[field]);
  let after;
  if (field === "TagIds") {
    const ids = [...new Set(args.tagIds)];
    labels(ids, tags);
    after =
      args.operation === "replace"
        ? ids
        : args.operation === "add"
          ? [...new Set([...before, ...ids])]
          : before.filter((id) => !ids.includes(id));
  } else after = args[field === "Title" ? "title" : "description"];
  assertCustomizationPatch({ [field]: after }, [
    "Title",
    "Description",
    "TagIds",
  ]);
  if (same(field, before, after))
    return { outcome: { status: "no_change" }, proposal: null };
  const prior = session.proposals.find(
    (p) =>
      p.status === "pending_review" &&
      p.mediaId === args.mediaId &&
      p.field === field &&
      same(field, p.before, before) &&
      same(field, p.after, after),
  );
  if (prior)
    return {
      outcome: { status: "proposal_created", proposalId: prior.id },
      proposal: null,
    };
  budget.reserve("proposals");
  const sha256 = await fingerprint(found.absolutePath, signal);
  signal.throwIfAborted();
  const proposal = {
    id: randomUUID(),
    callId: call.id,
    mediaId: args.mediaId,
    field,
    before,
    after,
    tags:
      field === "TagIds"
        ? labels([...new Set([...before, ...after])], tags)
        : [],
    name: path.basename(found.item.FilePath),
    sha256,
    createdAt: new Date().toISOString(),
    status: "pending_review",
    decidedAt: null,
    refreshOf: null,
  };
  return {
    outcome: { status: "proposal_created", proposalId: proposal.id },
    proposal,
  };
}
function assertProposal(p) {
  exact(p, [
    "id",
    "callId",
    "mediaId",
    "field",
    "before",
    "after",
    "tags",
    "name",
    "sha256",
    "createdAt",
    "status",
    "decidedAt",
    "refreshOf",
  ]);
  [p.id, p.callId, p.mediaId].forEach(uuid);
  if (p.refreshOf !== null) uuid(p.refreshOf);
  if (!["Title", "Description", "TagIds"].includes(p.field))
    throw new Error("Invalid proposed field");
  assertCustomizationPatch({ [p.field]: p.before }, [p.field]);
  assertCustomizationPatch({ [p.field]: p.after }, [p.field]);
  if (!Array.isArray(p.tags)) throw new Error("Invalid tag snapshots");
  for (const t of p.tags) {
    exact(t, ["TagId", "Text"]);
    uuid(t.TagId);
    str(t.Text);
  }
  const expected =
    p.field === "TagIds" ? [...new Set([...p.before, ...p.after])].sort() : [];
  if (
    JSON.stringify(p.tags.map((t) => t.TagId).sort()) !==
    JSON.stringify(expected)
  )
    throw new Error("Invalid tag snapshot references");
  if (same(p.field, p.before, p.after)) throw new Error("Empty proposal");
  if (
    !["pending_review", "accepted", "declined", "stale"].includes(p.status) ||
    !/^[a-f0-9]{64}$/.test(p.sha256)
  )
    throw new Error("Invalid proposal state");
  if (
    !Number.isFinite(Date.parse(p.createdAt)) ||
    (p.decidedAt !== null && !Number.isFinite(Date.parse(p.decidedAt)))
  )
    throw new Error("Invalid proposal time");
  if (["accepted", "declined"].includes(p.status) !== (p.decidedAt !== null))
    throw new Error("Invalid review decision");
  str(p.name, 500);
}
async function isCurrent(p, resolveMedia, tags) {
  try {
    const found = resolveMedia(p.mediaId);
    if (!same(p.field, p.before, found.item.Customization[p.field]))
      return false;
    if (
      p.tags.some((t) => tags.find((v) => v.TagId === t.TagId)?.Text !== t.Text)
    )
      return false;
    return (await fingerprint(found.absolutePath)) === p.sha256;
  } catch {
    return false;
  }
}
module.exports = { prepareProposal, assertProposal, isCurrent, same, labels };
