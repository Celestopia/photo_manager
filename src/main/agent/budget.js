const LIMITS = Object.freeze({
  viewer: { seconds: 120, calls: 8, images: 12, money: 1 },
  search: { seconds: 180, calls: 2, images: 0, money: 0.1 },
  batch: { seconds: 300, calls: 120, images: 400, money: 5 },
  verify: { seconds: 180, calls: 50, images: 120, money: 2 },
  index: { seconds: 1800, calls: Infinity, images: 5000, money: Infinity },
});
function createBudget(mode, signal, now = Date.now, runtime = {}) {
  if (!LIMITS[mode]) throw new Error("Invalid budget mode");
  const limit = { ...LIMITS[mode], ...runtime.budgets?.[mode] };
  const started = now(); let calls = 0, images = 0, estimatedCost = 0;
  function check() {
    signal?.throwIfAborted();
    if (now() - started >= limit.seconds * 1000) throw Object.assign(new Error("Time budget reached; continue explicitly"), { code: "BUDGET" });
  }
  function reserve({ imageCount = 0, cost = 0 } = {}) {
    check();
    if (calls + 1 > limit.calls || images + imageCount > limit.images || estimatedCost + cost > limit.money) throw Object.assign(new Error("Run budget reached; continue explicitly"), { code: "BUDGET" });
    calls++; images += imageCount; estimatedCost += cost;
  }
  return { check, reserve, seconds: limit.seconds,
    estimate: (inputUnits, outputTokens) => (inputUnits * (runtime.prices?.inputPerMillion ?? 1) + outputTokens * (runtime.prices?.outputPerMillion ?? 10)) / 1e6,
    snapshot: () => ({ calls, images, estimatedCost, currency: runtime.prices?.currency || 'USD', elapsedSeconds: Math.round((now() - started) / 1000) }) };
}
module.exports = { LIMITS, createBudget };
