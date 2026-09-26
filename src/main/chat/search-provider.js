const fs = require('node:fs/promises');
const yaml = require('js-yaml');
const { randomUUID } = require('node:crypto');
const { writeTextAtomic } = require('../../core/library-core');
const { exact, str, AgentError } = require('./runtime');
const { publicUrl, clip, validateSearch } = require('./web-sources');
const DEFAULT = { schemaVersion: 1, provider: 'tavily', apiKey: '', apiKeyEnv: 'TAVILY_API_KEY' };
function validate(c) {
  exact(c, Object.keys(DEFAULT), 'Search configuration');
  if (c.schemaVersion !== 1 || c.provider !== 'tavily') throw new Error('Unsupported search provider configuration');
  str(c.apiKey, 4096); str(c.apiKeyEnv, 200);
  return c;
}
async function read(file, create = false) {
  try { return validate(yaml.load(await fs.readFile(file, 'utf8'))); }
  catch (e) {
    if (e.code === 'ENOENT' && create) { await writeTextAtomic(file, yaml.dump(DEFAULT)); return { ...DEFAULT }; }
    throw new Error('Configure Web search in Provider settings (search-provider.yml).');
  }
}
async function config(file, env = process.env) {
  const c = await read(file);
  const apiKey = c.apiKey || env[c.apiKeyEnv] || '';
  if (!apiKey) throw new Error('Set a Tavily API key in Web search settings or its environment variable.');
  return { ...c, apiKey };
}
async function editableConfig(file, env = process.env) {
  const c = await read(file, true);
  return { provider: c.provider, apiKey: '', apiKeyEnv: c.apiKeyEnv, clearKey: false, hasKey: Boolean(c.apiKey), hasEnvironmentKey: Boolean(env[c.apiKeyEnv]), configured: Boolean(c.apiKey || env[c.apiKeyEnv]) };
}
let queue = Promise.resolve();
function saveConfig(file, draft) {
  const task = queue.then(async () => {
    exact(draft, ['provider', 'apiKey', 'apiKeyEnv', 'clearKey'], 'Search settings');
    if (typeof draft.clearKey !== 'boolean') throw new Error('Invalid search settings');
    const previous = await read(file, true);
    const c = validate({ schemaVersion: 1, provider: draft.provider, apiKey: draft.clearKey ? '' : draft.apiKey || previous.apiKey, apiKeyEnv: draft.apiKeyEnv });
    str(draft.apiKey, 4096);
    await writeTextAtomic(file, yaml.dump(c));
    return editableConfig(file);
  });
  queue = task.catch(() => {});
  return task;
}
function adapter(c, fetchImpl = fetch) {
  async function post(endpoint, body, signal) {
    const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20000)]);
    let reader;
    try {
      combined.throwIfAborted();
      const response = await fetchImpl(`https://api.tavily.com/${endpoint}`, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: combined });
      if (!response.ok) { await response.body?.cancel(); throw new AgentError('search_unavailable', `Tavily returned HTTP ${response.status}. Check the key, quota, and connection.`); }
      reader = response.body.getReader();
      const chunks = []; let size = 0;
      while (true) {
        combined.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) throw new AgentError('search_response_limit', 'The search response exceeded 1 MiB. Narrow the query.');
        chunks.push(Buffer.from(value));
      }
      combined.throwIfAborted();
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (e) {
      if (signal?.aborted) throw signal.reason;
      if (e instanceof AgentError) throw e;
      throw new AgentError('search_unavailable', combined.aborted ? 'The web request timed out.' : 'The web request failed or returned an invalid response.');
    } finally { if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } }
  }
  const credits = r => Number.isFinite(r.usage?.credits) && r.usage.credits >= 0 ? r.usage.credits : null;
  return {
    async search({ query, signal }) {
      const raw = await post('search', { query, search_depth: 'basic', topic: 'general', max_results: 5, auto_parameters: false, include_answer: false, include_raw_content: false, include_images: false, include_favicon: false, include_usage: true }, signal);
      if (!Array.isArray(raw.results)) throw new AgentError('search_invalid_response', 'Tavily did not return structured search results.');
      const result = { status: 'success', provider: 'tavily', retrievedAt: new Date().toISOString(), sources: [], discardedCount: 0, truncated: false, credits: credits(raw) };
      const urls = new Set();
      for (const entry of raw.results) {
        let url;
        try { url = publicUrl(entry.url); } catch { result.discardedCount++; continue; }
        if (typeof entry.title !== 'string' || typeof entry.content !== 'string') throw new AgentError('search_invalid_response', 'Tavily returned malformed source evidence.');
        if (urls.has(url) || result.sources.length >= 5) { result.discardedCount++; continue; }
        urls.add(url);
        const excerpt = clip(entry.content, 1024);
        result.sources.push({ sourceId: randomUUID(), title: [...entry.title].slice(0, 150).join(''), url, excerpt, publishedAt: typeof entry.published_date === 'string' && Number.isFinite(Date.parse(entry.published_date)) ? new Date(entry.published_date).toISOString() : null, truncated: excerpt !== entry.content });
      }
      result.truncated = result.discardedCount > 0 || result.sources.some(s => s.truncated);
      validateSearch(result);
      return result;
    },
    async extract({ url, signal }) {
      url = publicUrl(url);
      const raw = await post('extract', { urls: [url], extract_depth: 'basic', format: 'text', include_images: false, include_favicon: false, include_usage: true, timeout: 15 }, signal);
      if (!Array.isArray(raw.results)) throw new AgentError('search_invalid_response', 'Tavily did not return structured page content.');
      const entry = raw.results[0];
      if (!entry || typeof entry.raw_content !== 'string' || !entry.raw_content.trim()) throw new AgentError('page_unavailable', 'Search succeeded, but this page could not be extracted.');
      if (publicUrl(entry.url) !== url || raw.results.length !== 1) throw new AgentError('search_invalid_response', 'The extraction response did not match the requested source.');
      const text = clip(entry.raw_content, 10240);
      return { status: 'success', provider: 'tavily', retrievedAt: new Date().toISOString(), text, truncated: text !== entry.raw_content, credits: credits(raw) };
    },
  };
}
module.exports = { config, editableConfig, saveConfig, adapter };
