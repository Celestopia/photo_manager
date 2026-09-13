const { AgentError, errorResult, exact, str } = require("../runtime");
function createToolRegistry(definitions) {
  const registry = new Map();
  for (const d of definitions) {
    if (
      !d.name ||
      registry.has(d.name) ||
      d.contractVersion !== 1 ||
      typeof d.validate !== "function" ||
      typeof d.validateResult !== "function" ||
      typeof d.execute !== "function"
    )
      throw new Error("Invalid or duplicate tool registration");
    registry.set(d.name, Object.freeze(d));
  }
  function validateOutcome(name, outcome) {
    if (outcome?.status === "error") {
      exact(outcome, ["status", "code", "message"]);
      str(outcome.code, 100);
      str(outcome.message, 500);
      return;
    }
    const d = registry.get(name);
    if (!d) throw new Error("Unsupported tool result contract");
    d.validateResult(outcome);
  }
  return {
    available: (scope) =>
      [...registry.values()].filter((d) => d.available(scope)),
    validateOutcome,
    async execute(call, ctx) {
      try {
        ctx.signal.throwIfAborted();
        ctx.budget.reserve("calls");
        const d = registry.get(call.name);
        if (!d || !ctx.enabled.includes(d.name) || !d.available(ctx.scope))
          throw new AgentError(
            "permission_denied",
            "This tool is not available in this turn.",
          );
        let args;
        try {
          args = JSON.parse(call.arguments);
          d.validate(args);
        } catch {
          throw new AgentError(
            "invalid_arguments",
            "Tool arguments do not match the required schema.",
          );
        }
        if (args.mediaId) {
          if (!ctx.scope.mediaIds.includes(args.mediaId))
            throw new AgentError(
              "permission_denied",
              "This media was not supplied for this conversation.",
            );
          if (!ctx.represented.has(args.mediaId))
            throw new AgentError(
              "context_unavailable",
              "This media does not fit in the current context. Attach it in a new conversation.",
            );
        }
        ctx.checkLibrary();
        const toolSignal = AbortSignal.any([
          ctx.signal,
          AbortSignal.timeout(d.timeoutMs || 30000),
        ]);
        const result = await d.execute(
          args,
          { ...ctx, signal: toolSignal },
          call,
        );
        toolSignal.throwIfAborted();
        validateOutcome(d.name, result);
        const size = Buffer.byteLength(JSON.stringify(result));
        if (size > ctx.budget.policy.resultBytes)
          throw new AgentError(
            "budget_exceeded",
            "The tool result is too large. Narrow the request.",
          );
        ctx.budget.reserve("outputBytes", size);
        return result;
      } catch (e) {
        if (ctx.signal.aborted || e.code === "persistence_error") throw e;
        return errorResult(
          e instanceof AgentError ? e.code : "service_unavailable",
          e instanceof AgentError
            ? e.message
            : "The tool could not complete. Check the source and try again.",
        );
      }
    },
  };
}
module.exports = { createToolRegistry };
