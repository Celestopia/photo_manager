const { randomUUID } = require("node:crypto");
const { assertExactObjectKeys } = require("../../shared/object-schema");
const { assertUuidV4 } = require("../../shared/identity-schema");
const ACTIVE = [
  "pending",
  "preparing",
  "generating",
  "executing",
  "finalizing",
];
const transitions = {
  pending: ["preparing", "finalizing"],
  preparing: ["generating", "finalizing"],
  generating: ["executing", "finalizing"],
  executing: ["generating", "finalizing"],
  finalizing: ["complete", "failed", "stopped"],
};
function transition(message, next) {
  if (!transitions[message.status]?.includes(next))
    throw new Error(`Invalid run transition: ${message.status} -> ${next}`);
  message.status = next;
}
function exact(v, keys, label = "Agent record") {
  assertExactObjectKeys(v, keys, label);
  if (keys.some((k) => !(k in v)))
    throw new Error(`${label} is missing required fields`);
}
function str(v, max = 200000) {
  if (typeof v !== "string" || v.length > max)
    throw new Error("Invalid agent text");
}
function uuid(v) {
  assertUuidV4(v, "Agent ID");
}
function usage(v) {
  if (v === null) return;
  exact(v, ["inputCacheHit", "inputCacheMiss", "inputTotal", "output"]);
  for (const n of Object.values(v))
    if (n !== null && (!Number.isSafeInteger(n) || n < 0))
      throw new Error("Invalid agent usage");
}
function completion(v, persisted = false) {
  exact(
    v,
    persisted
      ? ["kind", "id", "text", "calls", "finish", "usage", "continuation"]
      : ["text", "calls", "finish", "usage", "continuation"],
  );
  if (persisted) {
    uuid(v.id);
    if (v.kind !== "completion") throw new Error("Invalid completion");
  }
  str(v.text);
  usage(v.usage);
  if (
    !["pending", "stop", "calls", "refusal"].includes(v.finish) ||
    (!persisted && v.finish === "pending")
  )
    throw new Error("Invalid completion outcome");
  if (!Array.isArray(v.calls) || v.calls.length > 32)
    throw new Error("Invalid calls");
  const hasCalls = v.calls.length > 0;
  if ((v.finish === "calls") !== hasCalls)
    throw new Error("Completion finish does not match calls");
  const providerIds = new Set();
  for (const c of v.calls) {
    exact(
      c,
      persisted
        ? ["id", "providerId", "name", "arguments"]
        : ["providerId", "name", "arguments"],
    );
    if (persisted) uuid(c.id);
    str(c.providerId, 200);
    str(c.name, 100);
    str(c.arguments, 100000);
    if (!c.providerId || !c.name || providerIds.has(c.providerId))
      throw new Error("Invalid call identity");
    providerIds.add(c.providerId);
  }
  if (v.continuation !== null) {
    exact(v.continuation, ["adapter", "reasoning"]);
    if (v.continuation.adapter !== "chat-completions")
      throw new Error("Unsupported continuation contract");
    str(v.continuation.reasoning);
  }
}
class AgentError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function errorResult(code, message) {
  return { status: "error", code, message };
}
function createBudget(limits = {}) {
  const policy = {
    completions: 8,
    calls: 12,
    proposals: 6,
    outputBytes: 65536,
    resultBytes: 16384,
    durationMs: 300000,
    ...limits,
  };
  const used = {};
  const deadline = Date.now() + policy.durationMs;
  return {
    policy,
    deadline,
    reserve(key, count = 1) {
      if (Date.now() >= deadline || (used[key] || 0) + count > policy[key])
        throw new AgentError(
          "budget_exceeded",
          "The turn reached its tool or time limit.",
        );
      used[key] = (used[key] || 0) + count;
    },
  };
}
function completionStep() {
  return {
    kind: "completion",
    id: randomUUID(),
    text: "",
    calls: [],
    finish: "pending",
    usage: null,
    continuation: null,
  };
}
function transcript(steps) {
  const out = [];
  for (const step of steps) {
    if (step.kind !== "completion" || step.finish === "pending") continue;
    const results = step.calls.map((c) =>
      steps.find((s) => s.kind === "tool" && s.callId === c.id),
    );
    if (results.some((r) => !r)) break;
    out.push({
      role: "assistant",
      content: step.text,
      calls: step.calls,
      continuation: step.continuation,
    });
    step.calls.forEach((c, i) =>
      out.push({
        role: "tool",
        providerId: c.providerId,
        content: JSON.stringify(results[i].outcome),
      }),
    );
  }
  return out;
}
module.exports = {
  ACTIVE,
  transition,
  exact,
  str,
  uuid,
  usage,
  completion,
  AgentError,
  errorResult,
  createBudget,
  completionStep,
  transcript,
};
