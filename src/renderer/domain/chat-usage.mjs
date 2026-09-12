export const usageFields = [ ['inputCacheHit', 'Input (cache hit)'], ['inputCacheMiss', 'Input (cache miss)'], ['inputTotal', 'Input (total)'], ['output', 'Output'] ];
export function sessionUsage(messages) {
  const attempts = messages.filter(m => m.role === 'assistant' && m.attempt);
  const usage = {};
  let incomplete = false;
  for (const [key] of usageFields) {
    const values = attempts.map(m => m.attempt.usage?.[key]).filter(v => v != null);
    usage[key] = values.length ? values.reduce((a,b) => a+b, 0) : null;
    if (values.length < attempts.length) incomplete = true;
  }
  return { usage, incomplete };
}
