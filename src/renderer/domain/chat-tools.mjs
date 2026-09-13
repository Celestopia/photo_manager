export const fieldLabel = (f) =>
  ({ Title: "Title", Description: "Description", TagIds: "Tags" })[f] || f;
export const tagName = (p, id) =>
  p.tags.find((t) => t.TagId === id)?.Text || "Unavailable tag";
export const value = (p, v, proposed = false) =>
  p.field === "TagIds"
    ? v.map((id) => tagName(p, id)).join(", ") || "(No tags)"
    : v || (proposed ? "(Clear field)" : "(Empty)");
export const statusLabel = (s) =>
  ({
    pending_review: "Pending review",
    accepted: "Accepted",
    declined: "Declined",
    stale: "Needs refresh",
  })[s] || s;
export const outcomeLabel = (v) =>
  ({
    success: "Complete",
    no_change: "No change",
    proposal_created: "Review required",
    error: "Unable to complete",
  })[v.status] || v.status;
export function toolLabel(message, id) {
  const call = message.attempt.steps
    .filter((s) => s.kind === "completion")
    .flatMap((s) => s.calls)
    .find((c) => c.id === id);
  return (
    {
      find_library_tags: "Find library tags",
      propose_title: "Suggest title",
      propose_description: "Suggest description",
      propose_tags: "Suggest tags",
    }[call?.name] ||
    call?.name ||
    "Tool"
  );
}
