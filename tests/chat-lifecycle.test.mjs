import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, ref, nextTick } from 'vue';
import { useChat } from '../src/renderer/composables/use-chat.js';

function fixture(t) {
  let chat, sequence = 0, delayDescribe = null;
  const sessions = new Map(), abandoned = [];
  const selectedItem = ref({ MediaId: 'A' });
  const ok = value => Promise.resolve({ ok: true, value });
  const api = {
    onEvent: () => () => {}, stop: () => ok(),
    create: () => { const s = { sessionId: String(++sequence), messages: [], attachments: [], title: '' }; sessions.set(s.sessionId, s); return ok(s); },
    describe: async (sid, input) => { if (delayDescribe) { const delay = delayDescribe; delayDescribe = null; await delay; } return ok({ ...input, name: input.id, mediaKind: 'image' }); },
    abandon: sid => { abandoned.push(sid); if (!sessions.get(sid).messages.length) sessions.delete(sid); return ok({}); },
    load: sid => ok(sessions.get(sid)),
    open: () => ok({ sessions: [...sessions.values()].filter(s => s.messages.length) }),
    send: payload => { const s = sessions.get(payload.sessionId); s.messages.push({ id: 'u', role: 'user', text: payload.text, inputs: payload.inputs, status: 'complete' }); return ok(s); },
  };
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  const app = renderer.createApp({ setup() { chat = useChat({ api, copyText() {}, selectedItem, libraryState: ref(null), view: ref('viewer') }); return () => null; } });
  app.mount({}); t.after(() => app.unmount());
  return { chat, sessions, abandoned, selectedItem, delay: p => { delayDescribe = p; } };
}
async function settle(f) { await nextTick(); await f.chat.open(); }

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
