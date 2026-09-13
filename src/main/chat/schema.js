const { randomUUID } = require("node:crypto");
const { assertExactObjectKeys } = require("../../shared/object-schema");
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const runtime = require("./runtime");
const { metadataTools, definitions } = require("./tools/metadata");
const { assertProposal } = require("./proposals");
const MODES = ["optimized", "original", "sampled"];
function id(value) {
  if (!UUID.test(value)) throw new Error("Invalid chat ID");
  return value;
}
function object(value, fields, label) {
  assertExactObjectKeys(value, fields, label);
  if (fields.some((field) => !(field in value)))
    throw new Error(`${label} is missing required fields`);
}
function string(value, max = 200000) {
  if (typeof value !== "string" || value.length > max)
    throw new Error("Invalid chat text");
}
function input(value) {
  object(value, ["kind", "id", "mode"], "Chat input");
  if (
    !["media", "attachment"].includes(value.kind) ||
    !MODES.includes(value.mode)
  )
    throw new Error("Invalid chat input");
  id(value.id);
}
function groups(value) {
  object(
    value,
    ["basic", "location", "people", "hidden", "technical"],
    "Metadata choices",
  );
  if (Object.values(value).some((v) => typeof v !== "boolean"))
    throw new Error("Invalid metadata choices");
}
function assertSession(s, libraryId) {
  object(
    s,
    [
      "schemaVersion",
      "sessionId",
      "libraryId",
      "title",
      "createdAt",
      "updatedAt",
      "messages",
      "attachments",
      "revision",
      "proposals",
    ],
    "Conversation",
  );
  if (s.schemaVersion !== 2 || s.libraryId !== libraryId)
    throw new Error("Conversation schema or library mismatch");
  if (
    !Number.isSafeInteger(s.revision) ||
    s.revision < 0 ||
    !Array.isArray(s.proposals)
  )
    throw new Error("Invalid conversation revision/proposals");
  id(s.sessionId);
  id(s.libraryId);
  string(s.title, 200);
  for (const t of [s.createdAt, s.updatedAt])
    if (!Number.isFinite(Date.parse(t)))
      throw new Error("Invalid conversation timestamp");
  if (!Array.isArray(s.messages) || !Array.isArray(s.attachments))
    throw new Error("Invalid conversation collections");
  const ids = new Set();
  const unique = (value) => {
    id(value);
    if (ids.has(value)) throw new Error("Duplicate chat ID");
    ids.add(value);
  };
  for (const a of s.attachments) {
    object(
      a,
      [
        "id",
        "name",
        "extension",
        "mime",
        "size",
        "sha256",
        "kind",
        "width",
        "height",
      ],
      "Attachment",
    );
    unique(a.id);
    string(a.name, 500);
    if (
      ![
        "jpg",
        "png",
        "webp",
        "bmp",
        "gif",
        "txt",
        "md",
        "csv",
        "json",
      ].includes(a.extension)
    )
      throw new Error("Invalid attachment extension");
    if (
      !["image", "gif", "text"].includes(a.kind) ||
      !Number.isInteger(a.size) ||
      a.size < 1 ||
      a.size > 20 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(a.sha256)
    )
      throw new Error("Invalid attachment record");
    string(a.mime, 100);
    for (const d of [a.width, a.height])
      if (d !== null && (!Number.isInteger(d) || d < 1))
        throw new Error("Invalid attachment dimensions");
  }
  const attachmentIds = new Set(s.attachments.map((a) => a.id));
  for (const m of s.messages) {
    object(
      m,
      [
        "id",
        "role",
        ...(m.role === "user" ? ["text"] : []),
        "createdAt",
        "updatedAt",
        "status",
        "inputs",
        "groups",
        "attempt",
      ],
      "Message",
    );
    unique(m.id);
    if (m.role === "user") string(m.text);
    if (
      !["user", "assistant"].includes(m.role) ||
      ![
        "draft",
        "pending",
        "preparing",
        "generating",
        "executing",
        "finalizing",
        "complete",
        "stopped",
        "failed",
        "interrupted",
      ].includes(m.status)
    )
      throw new Error("Invalid message state");
    for (const t of [m.createdAt, m.updatedAt])
      if (!Number.isFinite(Date.parse(t)))
        throw new Error("Invalid message timestamp");
    if (!Array.isArray(m.inputs) || m.inputs.length > 8)
      throw new Error("Invalid message inputs");
    groups(m.groups);
    for (const i of m.inputs) {
      input(i);
      if (i.kind === "attachment" && !attachmentIds.has(i.id))
        throw new Error("Missing attachment record");
    }
    if (m.attempt !== null) {
      object(
        m.attempt,
        [
          "model",
          "endpoint",
          "includedMessageIds",
          "inputs",
          "notice",
          "error",
          "retryOf",
          "steps",
          "scope",
          "tools",
          "reason",
        ],
        "Request record",
      );
      const run = m.attempt;
      if (m.role !== "assistant")
        throw new Error("User messages cannot own runs");
      object(run.scope, ["mediaIds", "groups"], "Run scope");
      groups(run.scope.groups);
      if (
        !Array.isArray(run.scope.mediaIds) ||
        new Set(run.scope.mediaIds).size !== run.scope.mediaIds.length
      )
        throw new Error("Invalid resource scope");
      run.scope.mediaIds.forEach(id);
      if (!Array.isArray(run.tools) || !Array.isArray(run.steps))
        throw new Error("Invalid run records");
      const enabled = new Set();
      for (const t of run.tools) {
        object(t, ["name", "contractVersion"], "Tool contract");
        if (
          t.contractVersion !== 1 ||
          !definitions.some((d) => d.name === t.name) ||
          enabled.has(t.name)
        )
          throw new Error("Unsupported tool contract");
        enabled.add(t.name);
      }
      string(run.reason, 100);
      const calls = new Map(),
        results = new Set();
      for (const step of run.steps) {
        if (step.kind === "completion") {
          if (calls.size !== results.size)
            throw new Error("Completion before tool results");
          runtime.completion(step, true);
          unique(step.id);
          for (const c of step.calls) {
            unique(c.id);
            calls.set(c.id, c);
          }
        } else {
          object(step, ["kind", "callId", "outcome"], "Tool result");
          if (
            step.kind !== "tool" ||
            !calls.has(step.callId) ||
            results.has(step.callId)
          )
            throw new Error("Invalid tool result reference");
          results.add(step.callId);
          metadataTools.validateOutcome(
            calls.get(step.callId).name,
            step.outcome,
          );
          if (
            step.outcome.status === "proposal_created" &&
            !s.proposals.some((p) => p.id === step.outcome.proposalId)
          )
            throw new Error("Missing proposal");
        }
      }
      string(m.attempt.model, 200);
      string(m.attempt.endpoint, 2000);
      string(m.attempt.notice);
      string(m.attempt.error);
      if (
        !Array.isArray(m.attempt.includedMessageIds) ||
        !Array.isArray(m.attempt.inputs)
      )
        throw new Error("Invalid request record");
      m.attempt.includedMessageIds.forEach(id);
      if (m.attempt.retryOf !== null) id(m.attempt.retryOf);
      for (const p of m.attempt.inputs) {
        object(
          p,
          [
            "messageId",
            "kind",
            "id",
            "mode",
            "sha256",
            "sourceSize",
            "width",
            "height",
            "metadata",
            "text",
            "uploads",
          ],
          "Upload record",
        );
        id(p.messageId);
        input({ kind: p.kind, id: p.id, mode: p.mode });
        if (
          !/^[a-f0-9]{64}$/.test(p.sha256) ||
          !Number.isSafeInteger(p.sourceSize) ||
          p.sourceSize < 1 ||
          !Array.isArray(p.uploads)
        )
          throw new Error("Invalid source record");
        string(p.text);
        for (const dimension of [p.width, p.height]) {
          if (
            dimension !== null &&
            (!Number.isInteger(dimension) || dimension < 1)
          ) {
            throw new Error("Invalid source dimensions");
          }
        }
        assertExactObjectKeys(
          p.metadata,
          [
            "title",
            "description",
            "tags",
            "location",
            "people",
            "hidden",
            "technical",
          ],
          "Supplied metadata",
        );
        for (const u of p.uploads) {
          object(
            u,
            [
              "mime",
              "size",
              "width",
              "height",
              "sha256",
              "transformation",
              "timestamp",
              "frameIndex",
            ],
            "Prepared upload",
          );
          if (
            !/^[a-f0-9]{64}$/.test(u.sha256) ||
            !Number.isInteger(u.size) ||
            u.size < 1
          )
            throw new Error("Invalid upload record");
          string(u.mime, 100);
          string(u.transformation, 500);
          for (const d of [u.width, u.height])
            if (!Number.isInteger(d) || d < 1)
              throw new Error("Invalid upload dimensions");
          if (
            u.timestamp !== null &&
            (!Number.isFinite(u.timestamp) || u.timestamp < 0)
          )
            throw new Error("Invalid sample time");
          if (
            u.frameIndex !== null &&
            (!Number.isInteger(u.frameIndex) || u.frameIndex < 0)
          )
            throw new Error("Invalid frame index");
        }
      }
    }
  }
  const messageIds = new Set(s.messages.map((m) => m.id));
  for (const m of s.messages)
    if (m.attempt) {
      if (
        m.attempt.includedMessageIds.some((v) => !messageIds.has(v)) ||
        (m.attempt.retryOf && !messageIds.has(m.attempt.retryOf))
      )
        throw new Error("Invalid history reference");
      if (m.attempt.inputs.some((v) => !messageIds.has(v.messageId)))
        throw new Error("Invalid upload message reference");
    }
  const calls = new Map(
    s.messages
      .flatMap((m) => m.attempt?.steps || [])
      .filter((v) => v.kind === "completion")
      .flatMap((v) => v.calls)
      .map((c) => [c.id, c]),
  );
  const mediaIds = new Set(
    s.messages
      .filter((m) => m.role === "user")
      .flatMap((m) => m.inputs)
      .filter((i) => i.kind === "media")
      .map((i) => i.id),
  );
  const submitted = new Set();
  for (const m of s.messages) {
    if (m.role === "user")
      m.inputs
        .filter((i) => i.kind === "media")
        .forEach((i) => submitted.add(i.id));
    if (m.attempt?.scope.mediaIds.some((v) => !submitted.has(v)))
      throw new Error("Unauthorized stored scope");
  }
  for (const p of s.proposals) {
    unique(p.id);
    assertProposal(p);
    const call = calls.get(p.callId);
    if (
      !call ||
      !mediaIds.has(p.mediaId) ||
      call.name !==
        {
          Title: "propose_title",
          Description: "propose_description",
          TagIds: "propose_tags",
        }[p.field]
    )
      throw new Error("Invalid proposal origin");
    const owner = s.messages.find((m) =>
      m.attempt?.steps.some(
        (step) =>
          step.kind === "completion" &&
          step.calls.some((c) => c.id === p.callId),
      ),
    );
    if (
      JSON.parse(call.arguments).mediaId !== p.mediaId ||
      !owner.attempt.scope.mediaIds.includes(p.mediaId)
    )
      throw new Error("Invalid proposal authority");
    if (
      p.refreshOf !== null &&
      !s.proposals
        .slice(0, s.proposals.indexOf(p))
        .some(
          (v) =>
            v.id === p.refreshOf &&
            v.callId === p.callId &&
            v.mediaId === p.mediaId &&
            v.field === p.field,
        )
    )
      throw new Error("Invalid refresh reference");
  }
  return s;
}
const defaultGroups = () => ({
  basic: true,
  location: false,
  people: false,
  hidden: false,
  technical: false,
});
function message(role, text, inputs = [], choices = defaultGroups()) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    role,
    ...(role === "user" ? { text } : {}),
    createdAt: now,
    updatedAt: now,
    status: role === "user" ? "complete" : "pending",
    inputs,
    groups: choices,
    attempt: null,
  };
}
module.exports = {
  id,
  input,
  groups,
  object,
  string,
  assertSession,
  defaultGroups,
  message,
};
