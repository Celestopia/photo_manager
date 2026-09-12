const keys = ['inputCacheHit', 'inputCacheMiss', 'inputTotal', 'output'];
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
function normalizeUsage(raw) {
  const inputTotal = count(raw.prompt_tokens);
  const output = count(raw.completion_tokens);
  let inputCacheHit = count(raw.prompt_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens);
  if (inputTotal !== null && inputCacheHit > inputTotal) inputCacheHit = null;
  const inputCacheMiss = inputTotal !== null && inputCacheHit !== null ? inputTotal - inputCacheHit : null;
  return { inputCacheHit, inputCacheMiss, inputTotal, output };
}
module.exports = { keys, normalizeUsage };
