const { exact } = require('./agent-schema');
const DEFAULT_AGENT_RUNTIME = {
  receiptRetentionDays: 30,
  budgets: { viewer: { seconds: 120, calls: 8, money: 1 }, search: { seconds: 180, calls: 2, money: 0.1 }, batch: { seconds: 300, calls: 120, money: 5 }, verify: { seconds: 180, calls: 50, money: 2 } },
  prices: { inputPerMillion: 4, outputPerMillion: 12, currency: 'CNY' },
};
function validateAgentRuntime(value) {
  exact(value, ['receiptRetentionDays', 'budgets', 'prices']);
  if (!Number.isInteger(value.receiptRetentionDays) || value.receiptRetentionDays < 1 || value.receiptRetentionDays > 365) throw new Error('Receipt retention must be 1–365 days');
  exact(value.budgets, ['viewer', 'search', 'batch', 'verify']);
  for (const limits of Object.values(value.budgets)) {
    exact(limits, ['seconds', 'calls', 'money']);
    if (!Number.isInteger(limits.seconds) || limits.seconds < 1 || limits.seconds > 3600 || !Number.isInteger(limits.calls) || limits.calls < 1 || limits.calls > 500 || !Number.isFinite(limits.money) || limits.money <= 0 || limits.money > 100) throw new Error('Invalid run budget');
  }
  exact(value.prices, ['inputPerMillion', 'outputPerMillion', 'currency']);
  if (!['inputPerMillion', 'outputPerMillion'].every(key => Number.isFinite(value.prices[key]) && value.prices[key] >= 0 && value.prices[key] <= 1000000) || !/^[A-Z]{3}$/.test(value.prices.currency)) throw new Error('Invalid estimated prices');
  return structuredClone(value);
}
module.exports = { DEFAULT_AGENT_RUNTIME, validateAgentRuntime };
