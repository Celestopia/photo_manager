import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reactive } from 'vue';
import { useAgent } from '../src/renderer/composables/use-agent.js';

function fixture(count = 1, overrides = {}) {
  const mediaIds = Array.from({ length: count }, () => randomUUID());
  let listener;
  const api = {
    onAgentState(callback) { listener = callback; return () => {}; },
    async agentPreview(payload) { return { ok: true, result: { ...payload, count: payload.mediaIds.length, items: payload.mediaIds.map(mediaId => ({ mediaId })), approvalId: randomUUID() } }; },
    async agentChat(payload) { return { ok: true, result: { runId: randomUUID(), results: payload.mediaIds.map(mediaId => ({ mediaId, question: payload.query, answer: 'Completed', proposals: [] })) } }; },
    ...overrides,
  };
  const query = reactive({});
  const agent = useAgent({ api, getMediaIds: () => mediaIds, getQuery: () => query, getView: () => 'gallery', refresh: async () => {} });
  agent.initialize(); agent.state.mode = 'chat'; agent.state.query = 'Describe these';
  return { agent, mediaIds, emit: event => listener(event) };
}

test('large selections require separate approved windows and preserve the unsent tail', async t => {
  const { agent } = fixture(105); t.after(agent.dispose);
  await agent.preview();
  assert.equal(agent.state.preview.count, 100);
  assert.equal(agent.state.preview.remaining.length, 105);
  await agent.send();
  assert.equal(agent.state.messages.length, 100);
  assert.equal(agent.state.remaining.length, 5);
  await agent.preview(true);
  assert.equal(agent.state.preview.count, 5);
  await agent.send();
  assert.equal(agent.state.remaining.length, 0);
  assert.equal(agent.state.messages.length, 100);
  assert.match(agent.state.notice, /Older displayed chat output/);
});

test('partial verification keeps completed results and continues only unfinished media', async t => {
  const { agent, mediaIds, emit } = fixture(45); t.after(agent.dispose);
  agent.state.mode = 'verify'; agent.state.results = { resultSetId: 'current', results: mediaIds.map(mediaId => ({ mediaId, group: 'visual-candidates' })) };
  await agent.preview(); assert.equal(agent.state.preview.count, 40);
  agent.state.remaining = [...mediaIds];
  emit({ sequence: 1, running: true, verifiedItem: { resultSetId: 'current', result: { mediaId: mediaIds[0], group: 'matches' } } });
  assert.equal(agent.state.results.results[0].group, 'matches');
  assert.equal(agent.state.remaining.length, 44);
  await agent.preview(true);
  assert.equal(agent.state.preview.items[0].mediaId, mediaIds[1]);
});

test('review apply remains locked until the durable apply response completes', async t => {
  let release, applyCalls = 0;
  const { agent, mediaIds } = fixture(1, {
    async agentRevise(payload) { return { ok: true, result: { proposalId: payload.proposalId, patch: payload.patch } }; },
    async agentApply() { applyCalls++; await new Promise(resolve => { release = resolve; }); return { ok: true, result: {} }; },
  }); t.after(agent.dispose);
  agent.state.proposals = [{ proposalId: randomUUID(), mediaId: mediaIds[0], patch: { Title: 'Reviewed' }, selectedFields: ['Title'] }];
  const applying = agent.apply();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(agent.state.applying, true);
  await agent.apply(); assert.equal(applyCalls, 1);
  release(); await applying;
  assert.equal(agent.state.applying, false);
  assert.equal(agent.state.proposals.length, 0);
});

test('agent payloads cross the Electron bridge as plain serializable data', async t => {
  let captured;
  const { agent } = fixture(1, { async agentSearch(payload) { captured = structuredClone(payload); return { ok: true, result: { resultSetId: 'frozen', results: [] } }; } });
  t.after(agent.dispose);
  agent.state.groups = reactive(['basic']);
  await agent.search();
  assert.equal(agent.state.error, '');
  assert.equal(captured.query, 'Describe these');
  await agent.search(true);
  assert.equal(captured.resultSetId, 'frozen');
});

test('one-click send captures the request before preparation and blocks duplicate sends', async t => {
  let release, sent, calls = 0;
  const { agent } = fixture(1, {
    async agentPreview(payload) { await new Promise(resolve => { release = resolve; }); return { ok: true, result: { ...payload, approvalId: 'prepared', items: payload.mediaIds.map(mediaId => ({ mediaId })) } }; },
    async agentChat(payload) { calls++; sent = payload; return { ok: true, result: { runId: 'one', results: [] } }; },
  }); t.after(agent.dispose);
  const pending = agent.submit();
  agent.state.query = 'A later draft'; agent.state.replaceTags = true; agent.state.groups = ['hidden'];
  await agent.submit();
  release(); await pending;
  assert.equal(calls, 1);
  assert.equal(sent.query, 'Describe these');
  assert.deepEqual(sent.groups, ['basic']);
  assert.equal(sent.replaceTags, false);
  assert.equal(sent.propose, true);
  assert.equal(sent.tagCatalogue, true);
  assert.equal(agent.state.query, 'A later draft');
});

test('new chat clears model context while retaining unsaved proposals', async t => {
  let cleared;
  const { agent, mediaIds } = fixture(1, { async agentClearChat(payload) { cleared = payload.mediaIds; return { ok: true }; } });
  t.after(agent.dispose);
  agent.state.messages = [{ mediaId: mediaIds[0], answer: 'Old reply' }];
  agent.state.proposals = [{ mediaId: mediaIds[0], proposalId: randomUUID() }];
  await agent.newChat();
  assert.deepEqual(cleared, mediaIds);
  assert.equal(agent.state.messages.length, 0);
  assert.equal(agent.state.proposals.length, 1);
  assert.match(agent.state.notice, /retained/);
});
