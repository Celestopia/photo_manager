import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, ref, nextTick } from 'vue';
import { useChat } from '../src/renderer/composables/use-chat.js';

function fixture(t) {
  let chat, sequence = 0, delayDescribe = null, receive, stops = 0;
  const sessions = new Map(), abandoned = [], previewCalls = [], failedPreviews = new Set(), previewDelays = new Map(), payloads = [];
  let configured = true;
  const selectedItem = ref({ MediaId: 'A' });
  const ok = value => Promise.resolve({ ok: true, value });
  const api = {
    searchConfiguration: () => ok({ provider: 'tavily', apiKey: '', apiKeyEnv: '', clearKey: false, hasKey: configured, configured }),
    onEvent: fn => { receive=fn; return () => {}; }, stop: () => { stops++; return ok(); },
    create: () => { const s = { sessionId: String(++sequence), messages: [], attachments: [], title: '' }; sessions.set(s.sessionId, s); return ok(s); },
    describe: async (sid, input) => { if (delayDescribe) { const delay = delayDescribe; delayDescribe = null; await delay; } return ok({ ...input, name: input.id, mediaKind: 'image' }); },
    preview: async (sid, input) => {
      previewCalls.push(input.id);
      if (previewDelays.has(input.id)) await previewDelays.get(input.id);
      return failedPreviews.has(input.id)
        ? { ok: false, error: `Could not preview ${input.id}` }
        : { ok: true, value: { previewUrl: `data:image/jpeg;base64,${input.id}`, name: input.id } };
    },
    abandon: sid => { abandoned.push(sid); if (!sessions.get(sid).messages.length) sessions.delete(sid); return ok({}); },
    load: sid => ok(sessions.get(sid)),
    open: () => ok({ sessions: [...sessions.values()].filter(s => s.messages.length) }),
    send: payload => { payloads.push(payload); const s = sessions.get(payload.sessionId); s.messages.push({ id: 'u', role: 'user', text: payload.text, inputs: payload.inputs, status: 'complete' }); return ok(s); },
  };
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  const app = renderer.createApp({ setup() { chat = useChat({ api, copyText() {}, selectedItem, libraryState: ref(null), view: ref('viewer') }); return () => null; } });
  app.mount({}); t.after(() => app.unmount());
  return {
    chat, sessions, abandoned, selectedItem, previewCalls, event: e=>receive(e), stops: () => stops,
    payloads, unconfigure: () => { configured = false; },
    delay: p => { delayDescribe = p; },
    failPreview: id => failedPreviews.add(id),
    delayPreview: (id, promise) => previewDelays.set(id, promise),
  };
}
async function settle(f) { await nextTick(); await f.chat.open(); }

test('web permission survives sending and hiding, resets on navigation, and Retry uses the visible choice', async t => {
  const f = fixture(t), c = f.chat; await c.open();
  assert.equal(c.webEnabled.value, false); await c.toggleWeb(); assert.equal(c.webEnabled.value, true);
  c.text.value = 'Research'; await c.send(); await c.stop(); assert.equal(f.payloads[0].webEnabled, true); assert.equal(c.webEnabled.value, true);
  c.close(); await c.open(); assert.equal(c.webEnabled.value, true);
  const m = { id: 'reply', role: 'assistant', inputs: [], status: 'failed' }; c.session.value.messages.push(m);
  await c.toggleWeb(); await c.retry(m); await c.stop(); assert.equal(f.payloads[1].webEnabled, false);
  await c.toggleWeb(); f.selectedItem.value = { MediaId: 'B' }; await settle(f); assert.equal(c.webEnabled.value, false);
  f.unconfigure(); await c.toggleWeb(); assert.equal(c.webEnabled.value, false); assert.equal(c.settings.value, true); assert.equal(c.settingsTab.value, 'web');
});

test('chat navigation replaces drafts, keeps same-media reopen, and resumes submitted history explicitly', async t => {
  const f = fixture(t), c = f.chat;
  await c.open(); const a = c.session.value.sessionId;
  await c.showHistory(); assert.equal(c.filteredHistory.value.length, 0);
  await c.close(); await c.open(); assert.equal(c.session.value.sessionId, a);
  c.text.value = 'unsent'; f.selectedItem.value = { MediaId: 'B' }; await settle(f);
  assert.equal(c.inputs.value[0].id, 'B'); assert.equal(c.text.value, ''); assert.ok(!f.sessions.has(a));
  await c.send(); const b = c.session.value.sessionId;
  await c.close(); f.selectedItem.value = { MediaId: 'C' }; await settle(f);
  assert.equal(c.inputs.value[0].id, 'C'); assert.ok(f.sessions.has(b));
  await c.showHistory(); assert.equal(c.filteredHistory.value.length, 1);
  const draft = c.session.value.sessionId; await c.load(b);
  assert.equal(c.session.value.sessionId, b); assert.equal(c.inputs.value.length, 0); assert.ok(!f.sessions.has(draft));
});

test('late preview results cannot restore an abandoned media draft', async t => {
  const f = fixture(t); let release;
  f.delay(new Promise(r => { release = r; }));
  const opening = f.chat.open();
  await new Promise(r => setImmediate(r));
  f.selectedItem.value = { MediaId: 'B' }; await nextTick();
  f.selectedItem.value = { MediaId: 'C' }; await nextTick();
  release(); await opening; await settle(f);
  assert.deepEqual(f.chat.inputs.value.map(i => i.id), ['C']);
  assert.equal(f.sessions.size, 1);
});

test('image preview state opens and is cleared with its conversation', async t => {
  const f = fixture(t), c = f.chat;
  await c.open();
  await c.openImagePreview(c.inputs.value[0]);
  assert.equal(c.imagePreview.value.name, 'A');
  f.selectedItem.value = { MediaId: 'B' };
  await settle(f);
  assert.equal(c.imagePreview.value, null);
});

test('image preview navigates one attachment group without wrapping and caches results', async t => {
  const f = fixture(t), c = f.chat;
  await c.open();
  const first = c.inputs.value[0];
  const second = { ...first, id: 'B', name: 'B' };
  const third = { ...first, id: 'C', name: 'C' };
  const group = [first, second, third].map(input => ({ input, name: input.name || input.id }));
  f.failPreview('B');

  await c.openImagePreview(first, 'A', group);
  assert.equal(c.imagePreview.value.index, 0);
  assert.equal(c.imagePreview.value.items.length, 3);
  assert.equal(await c.previousImagePreview(), false);

  await c.nextImagePreview();
  assert.equal(c.imagePreview.value.index, 1);
  assert.equal(c.imagePreview.value.error, 'Could not preview B');
  await c.nextImagePreview();
  assert.equal(c.imagePreview.value.index, 2);
  assert.equal(c.imagePreview.value.name, 'C');
  assert.equal(await c.nextImagePreview(), false);

  await c.previousImagePreview();
  await c.previousImagePreview();
  assert.equal(c.imagePreview.value.index, 0);
  assert.deepEqual(f.previewCalls, ['A', 'B', 'C']);
});

test('late image preview results do not replace a newer navigation target', async t => {
  const f = fixture(t), c = f.chat;
  await c.open();
  const first = c.inputs.value[0];
  const second = { ...first, id: 'B', name: 'B' };
  const third = { ...first, id: 'C', name: 'C' };
  let releaseSecond;
  f.delayPreview('B', new Promise(resolve => { releaseSecond = resolve; }));

  await c.openImagePreview(first, 'A', [first, second, third]);
  const secondPending = c.nextImagePreview();
  const thirdPending = c.nextImagePreview();
  await thirdPending;
  assert.equal(c.imagePreview.value.index, 2);
  assert.equal(c.imagePreview.value.name, 'C');
  releaseSecond();
  await secondPending;
  assert.equal(c.imagePreview.value.index, 2);
  assert.equal(c.imagePreview.value.name, 'C');
});


test('older session revisions and late run events cannot replace finalized review state',async t=>{
  const f=fixture(t);await f.chat.open();
  const sessionId=f.chat.session.value.sessionId;
  const live={sessionId,revision:2,messages:[{id:'run',role:'assistant',status:'generating',text:'Initial',inputs:[]}],proposals:[]};
  f.event({type:'session',session:structuredClone(live)});
  f.event({type:'reply',sessionId,runId:'run',sequence:2,message:{...live.messages[0],text:'Latest'}});
  f.event({type:'reply',sessionId,runId:'run',sequence:1,message:{...live.messages[0],text:'Older'}});
  assert.equal(f.chat.session.value.messages[0].text,'Latest');
  const final={...live,revision:3,messages:[{...live.messages[0],text:'Final',status:'complete'}],proposals:[{id:'proposal',status:'accepted'}]};
  f.event({type:'session',session:structuredClone(final)});
  f.event({type:'session',session:structuredClone(live)});
  f.event({type:'reply',sessionId,runId:'run',sequence:3,message:live.messages[0]});
  assert.equal(f.chat.session.value.messages[0].text,'Final');
  assert.equal(f.chat.session.value.proposals[0].status,'accepted');
  assert.equal(f.chat.busy.value,false);
});


test('hiding Assistant preserves streaming and tool execution until completion', async t => {
  const f = fixture(t), c = f.chat;
  await c.open();
  const sessionId = c.session.value.sessionId;
  const baseline = f.stops();
  const message = { id: 'run', role: 'assistant', status: 'generating', text: 'Partial', inputs: [] };
  f.event({ type: 'session', session: { sessionId, revision: 1, messages: [message], proposals: [] } });
  await c.close();
  assert.equal(c.visible.value, false);
  assert.equal(c.busy.value, true);
  assert.equal(f.stops(), baseline);
  f.event({ type: 'reply', sessionId, runId: 'run', sequence: 1, message: { ...message, text: 'More text' } });
  await c.open();
  assert.equal(c.session.value.messages[0].text, 'More text');
  f.event({ type: 'session', session: { sessionId, revision: 2, messages: [{ ...message, status: 'executing' }], proposals: [] } });
  await c.close();
  f.event({ type: 'session', session: { sessionId, revision: 3, messages: [{ ...message, status: 'complete', text: 'Finished' }], proposals: [{ id: 'proposal', status: 'pending_review' }] } });
  assert.equal(c.busy.value, false);
  await c.open();
  assert.equal(c.session.value.sessionId, sessionId);
  assert.equal(c.session.value.messages[0].text, 'Finished');
  assert.equal(c.session.value.proposals[0].status, 'pending_review');
  assert.equal(f.stops(), baseline);
  await c.stop();
  assert.equal(f.stops(), baseline + 1);
});
