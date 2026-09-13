const { randomUUID } = require("node:crypto");
const {
  transition,
  completion,
  completionStep,
  transcript,
  createBudget,
} = require("./runtime");

/** Provider- and domain-independent serial runner. Persistence failures always escape. */
async function runAgent({
  message,
  messages,
  complete,
  executor,
  definitions,
  context,
  save,
  progress,
  signal,
  budget = createBudget(),
}) {
  const deadlineSignal = AbortSignal.timeout(
    Math.max(1, budget.deadline - Date.now()),
  );
  const combined = AbortSignal.any([signal, deadlineSignal]);
  let reason = "stop";
  try {
    for (let round = 0; ; round++) {
      combined.throwIfAborted();
      budget.reserve("completions");
      transition(message, "generating");
      const step = completionStep();
      message.attempt.steps.push(step);
      await save();
      const result = await complete(
        [...messages, ...transcript(message.attempt.steps)],
        {
          tools: round >= budget.policy.completions - 1 ? [] : definitions,
          signal: combined,
          onText: (text) => {
            step.text = text;
            progress();
          },
          onUsage: (value) => {
            step.usage = value;
          },
        },
      );
      completion(result);
      Object.assign(step, result, {
        calls: result.calls.map((c) => ({ ...c, id: randomUUID() })),
      });
      await save();
      if (!step.calls.length) {
        reason = result.finish;
        break;
      }
      transition(message, "executing");
      await save();
      for (const call of step.calls) {
        combined.throwIfAborted();
        const outcome = await executor(call, {
          ...context,
          signal: combined,
          budget,
          enabled:
            round >= budget.policy.completions - 1
              ? []
              : definitions.map((d) => d.name),
        });
        context.afterTool?.(call, outcome);
        message.attempt.steps.push({ kind: "tool", callId: call.id, outcome });
        // A proposal staged by an executor and its result become durable together.
        await save();
      }
      if (round >= budget.policy.completions - 1) {
        reason = "budget_exceeded";
        break;
      }
    }
  } catch (e) {
    reason = signal.aborted
      ? "stopped"
      : deadlineSignal.aborted
        ? "budget_exceeded"
        : e.code || "failed";
    message.attempt.error = signal.aborted
      ? "Reply stopped."
      : deadlineSignal.aborted
        ? "The turn time limit was reached."
        : e.message;
    if (e.code === "persistence_error") throw e;
  }
  transition(message, "finalizing");
  await save();
  message.attempt.reason = reason;
  transition(
    message,
    signal.aborted ? "stopped" : message.attempt.error ? "failed" : "complete",
  );
  await save();
}
module.exports = { runAgent };
