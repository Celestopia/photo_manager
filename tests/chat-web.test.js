const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const yaml = require('js-yaml');
const search = require('../src/main/chat/search-provider');
const { publicUrl, clip } = require('../src/main/chat/web-sources');
const { tools } = require('../src/main/chat/tools');
const { createBudget } = require('../src/main/chat/runtime');
const { createChatService } = require('../src/main/chat/service');
const { defaultGroups, assertSession } = require('../src/main/chat/schema');
const { resolveLibraryPaths } = require('../scripts/library-core');
const json = value => new Response(JSON.stringify(value));
const result = { results: [{ title: 'Eiffel Tower', url: 'https://www.toureiffel.paris/en', content: 'A landmark in Paris.' }], usage: { credits: 1 } };
const extracted = { results: [{ url: result.results[0].url, raw_content: 'The Eiffel Tower is in Paris.' }], usage: { credits: 0.2 } };
const event = value => 'data: ' + JSON.stringify(value) + '\n\n';
function completion(text, calls = []) {
  return new Response(event({ choices: [{ delta: { content: text, tool_calls: calls.map((c, index) => ({ index, id: 'call_' + index, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } }] }) + event({ choices: [{ delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop' }] }) + 'data: [DONE]\n\n');
}
async function fixture(t, respond, webFetch = async url => json(url.endsWith('/search') ? result : extracted)) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photo-manager-web-'));
  const paths = resolveLibraryPaths(root), library = { paths, manifest: { libraryId: randomUUID() } };
  await fs.mkdir(paths.managerDir, { recursive: true });
  const configFile = path.join(root, 'chat.yml'), searchConfigFile = path.join(root, 'search.yml');
  await fs.writeFile(configFile, yaml.dump({ ...require('../src/main/chat/provider').DEFAULT, baseUrl: 'https://model.example.com/v1' }));
  await search.editableConfig(searchConfigFile);
  await search.saveConfig(searchConfigFile, { provider: 'tavily', apiKey: 'test-secret', apiKeyEnv: '', clearKey: false });
  const requests = [], webRequests = [];
  const chat = createChatService({ getLibrary: () => library, resolveMedia: () => { throw new Error('No media'); }, getMetadata: () => ({}), configFile, searchConfigFile, getMediaToolPaths: () => ({}), emit: () => {}, fetchImpl: async (_, options) => { const body = JSON.parse(options.body); requests.push(body); return respond(body, requests.length); }, searchFetchImpl: async (url, options) => { webRequests.push({ url, body: JSON.parse(options.body) }); return webFetch(url, options); } });
  t.after(async () => { await chat.close(); await fs.rm(root, { recursive: true, force: true }); });
  const session = await chat.create();
  const payload = { sessionId: session.sessionId, text: 'Research the Eiffel Tower', inputs: [], groups: defaultGroups(), excludeInputs: [], acceptChanges: false, retryOf: null, webEnabled: true };
  async function send(overrides = {}) {
    await chat.send({ ...payload, ...overrides });
    for (let i = 0; chat.isBusy() && i < 500; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(chat.isBusy(), false);
    return chat.load(session.sessionId);
  }
  return { chat, library, requests, webRequests, payload, send, searchConfigFile };
}

test('source URLs reject local, encoded IP, credential and executable targets', () => {
  for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'https://user:secret@host.org', 'http://127.0.0.1', 'http://2130706433', 'http://0x7f000001', 'http://[::1]', 'https://localhost', 'https://a.local', 'https://x.internal', 'https://foo', 'https://a.org/%zz', 'https://a.org\\evil', 'https://a.test']) assert.throws(() => publicUrl(url), undefined, url);
  assert.equal(publicUrl('HTTPS://WWW.TOUREIFFEL.PARIS/en?q=中文#section'), 'https://www.toureiffel.paris/en?q=%E4%B8%AD%E6%96%87');
  assert.equal(clip('中文😀', 7), '中文');
});
test('search configuration keeps independent credentials and explicit environment fallback', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-search-config-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'search.yml');
  assert.equal((await search.editableConfig(file, {})).configured, false);
  const draft = { provider: 'tavily', apiKey: 'secret', apiKeyEnv: 'KEY', clearKey: false };
  assert.equal(JSON.stringify(await search.saveConfig(file, draft)).includes('secret'), false);
  await search.saveConfig(file, { ...draft, apiKey: '' });
  assert.equal((await search.config(file, { KEY: 'env-secret' })).apiKey, 'secret');
  await search.saveConfig(file, { ...draft, apiKey: '', clearKey: true });
  assert.equal((await search.config(file, { KEY: 'env-secret' })).apiKey, 'env-secret');
  assert.equal(JSON.stringify(await search.editableConfig(file, { KEY: 'env-secret' })).includes('env-secret'), false);
  await assert.rejects(search.saveConfig(file, { ...draft, model: 'bad' }), /unsupported/);
  await assert.rejects(search.config(file, {}), /key/);
});
test('Tavily wire requests are bounded, minimal and preserve Unicode with separate fractional usage', async () => {
  const requests = [];
  const adapter = search.adapter({ apiKey: 'secret' }, async (url, options) => { requests.push({ url, ...options }); return json(url.endsWith('search') ? { ...result, results: [...result.results, { ...result.results[0] }, { title: 'bad', url: 'http://localhost', content: 'bad' }] } : extracted); });
  const found = await adapter.search({ query: '巴黎铁塔' });
  assert.equal(found.sources.length, 1); assert.equal(found.discardedCount, 2);
  assert.equal(found.credits, 1);
  const read = await adapter.extract({ url: found.sources[0].url }); assert.equal(read.credits, 0.2);
  assert.equal(requests[0].redirect, 'error');
  assert.equal(requests[0].headers.Authorization, 'Bearer secret');
  const body = JSON.parse(requests[0].body); assert.equal(body.query, '巴黎铁塔'); assert.equal(body.max_results, 5); assert.equal(body.include_answer, false); assert.equal(body.include_usage, true); assert.equal('messages' in body, false);
  assert.deepEqual(JSON.parse(requests[1].body).urls, [result.results[0].url]);
  assert.equal(JSON.stringify(found).includes('secret'), false);
});
test('search rejects prose, oversized bodies and mismatched extraction without retry or secret leakage', async () => {
  let calls = 0;
  for (const response of [() => json({ answer: 'I searched' }), () => new Response('x'.repeat(1048577)), () => new Response('private-secret', { status: 401 })]) {
    const adapter = search.adapter({ apiKey: 'secret' }, async () => { calls++; return response(); });
    await assert.rejects(adapter.search({ query: 'test' }), e => !e.message.includes('private-secret'));
  }
  assert.equal(calls, 3);
  const adapter = search.adapter({ apiKey: 'secret' }, async () => json({ results: [{ url: 'https://other.org/', raw_content: 'not requested' }] }));
  await assert.rejects(adapter.extract({ url: result.results[0].url }), /match/);
});
test('web tools deny off and foreign sources and enforce per-tool limits before network', async () => {
  let calls = 0;
  const scope = { mediaIds: [], groups: defaultGroups(), webEnabled: false };
  const ctx = { scope, signal: new AbortController().signal, budget: createBudget(), enabled: ['web_search', 'read_web_page'], represented: new Set(), checkLibrary() {}, webSources: new Map(), web: { search: async () => { calls++; return { status: 'success', provider: 'tavily', retrievedAt: new Date().toISOString(), sources: [], discardedCount: 0, truncated: false, credits: null }; } } };
  const call = { name: 'web_search', arguments: '{"query":"test"}' };
  assert.equal((await tools.execute(call, ctx)).code, 'permission_denied');
  scope.webEnabled = true;
  assert.equal((await tools.execute({ name: 'read_web_page', arguments: JSON.stringify({ sourceId: randomUUID() }) }, ctx)).code, 'permission_denied');
  for (let n = 0; n < 3; n++) assert.equal((await tools.execute(call, ctx)).status, 'success');
  assert.equal((await tools.execute(call, ctx)).code, 'budget_exceeded'); assert.equal(calls, 3);
  assert.throws(() => createBudget().reserve('unknown'), /Invalid budget/);
});
test('search and page results round-trip with same-attempt provenance and safe saved-source resolution', async t => {
  const f = await fixture(t, (body, n) => {
    if (n === 1) return completion('', [{ name: 'web_search', args: { query: 'Eiffel Tower' } }]);
    const searchResult = body.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content)).find(o => o.sources);
    if (n === 2) return completion('', [{ name: 'read_web_page', args: { sourceId: searchResult.sources[0].sourceId } }]);
    return completion(`The tower is in Paris [source:${searchResult.sources[0].sourceId}].`);
  });
  const s = await f.send(); assert.equal(s.messages[1].status, 'complete');
  const raw = JSON.parse(await fs.readFile(path.join(f.library.paths.managerDir, 'chat/v2/sessions', s.sessionId, 'session.json'), 'utf8'));
  assertSession(raw, f.library.manifest.libraryId);
  const source = raw.messages[1].attempt.steps[1].outcome.sources[0];
  assert.equal(await f.chat.sourceUrl(s.sessionId, source.sourceId), source.url);
  await assert.rejects(f.chat.sourceUrl(s.sessionId, randomUUID()), /not found/);
  const forged = structuredClone(raw); forged.messages[1].attempt.steps[3].outcome.sourceId = randomUUID(); assert.throws(() => assertSession(forged, f.library.manifest.libraryId), /provenance/);
  const duplicate = structuredClone(raw); duplicate.messages[1].attempt.steps[1].outcome.sources[0].sourceId = raw.sessionId; assert.throws(() => assertSession(duplicate, f.library.manifest.libraryId));
  assert.equal(f.webRequests.length, 2);
  await f.chat.load(s.sessionId); assert.equal(f.webRequests.length, 2);
});
test('web off requires no search configuration and rejects model-requested network calls', async t => {
  const f = await fixture(t, (_, n) => n === 1 ? completion('', [{ name: 'web_search', args: { query: 'test' } }]) : completion('Web unavailable'));
  await fs.rm(f.searchConfigFile);
  const s = await f.send({ webEnabled: false });
  assert.equal(f.webRequests.length, 0); assert.equal(s.messages[1].attempt.steps[1].outcome.code, 'permission_denied');
  assert.equal(f.requests[0].tools, undefined);
  await assert.rejects(fs.access(f.searchConfigFile));
  await assert.rejects(f.chat.send({ ...f.payload, webEnabled: true }), /Configure/);
  assert.equal((await f.chat.load(s.sessionId)).messages.length, 2);
});
test('Stop aborts an in-flight web request without later calls or history replay', async t => {
  let started; const beginning = new Promise(r => { started = r; }); let aborted = false;
  const f = await fixture(t, () => completion('', [{ name: 'web_search', args: { query: 'test' } }]), async (_, options) => {
    started(); return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(options.signal.reason); }, { once: true }));
  });
  await f.chat.send(f.payload); await beginning; await f.chat.stop();
  assert.equal(aborted, true); assert.equal(f.requests.length, 1);
  const s = await f.chat.load(f.payload.sessionId); assert.equal(s.messages[1].status, 'stopped'); assert.equal(f.webRequests.length, 1);
});
test('large multilingual extraction truncates on Unicode boundaries and is marked explicitly', async () => {
  const adapter = search.adapter({ apiKey: 'secret' }, async () => json({ ...extracted, results: [{ ...extracted.results[0], raw_content: '中文😀'.repeat(10000) }] }));
  const r = await adapter.extract({ url: result.results[0].url });
  assert.equal(r.truncated, true); assert.ok(Buffer.byteLength(r.text) <= 10240); assert.equal(r.text.includes('\ufffd'), false);
});
