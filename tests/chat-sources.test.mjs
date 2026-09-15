import test from 'node:test';
import assert from 'node:assert/strict';
import { renderChatMarkdown } from '../src/renderer/domain/chat-markdown.mjs';
import { sourcesBefore, webUsage } from '../src/renderer/domain/chat-sources.mjs';
const id = '00000000-0000-4000-8000-000000000001';
const source = { sourceId: id, title: '<script>evil</script>', url: 'https://www.toureiffel.paris/en' };
test('citations resolve only supplied IDs and never activate arbitrary links or code', () => {
  const text = `[source:${id}] [unsafe](javascript:alert(1)) ![remote](https://image.org/a.png) \`[source:${id}]\``;
  const html = renderChatMarkdown(text, [source]);
  assert.equal((html.match(/data-source-id=/g) || []).length, 1);
  assert.ok(html.includes('&lt;script&gt;')); assert.equal(html.includes('<script>'), false); assert.equal(html.includes('<img'), false); assert.equal(html.includes('href='), false);
  assert.equal(renderChatMarkdown(`[source:${id}]`).includes('<button'), false);
});
test('source context excludes future results, omitted turns and incomplete historical groups', () => {
  const search = { kind: 'tool', callId: 'c', outcome: { status: 'success', sources: [source], provider: 'tavily', credits: 0.2 } };
  const message = { id: 'm', attempt: { includedMessageIds: [], steps: [{ kind: 'completion', id: 'before', calls: [{ id: 'c', name: 'web_search' }] }, search, { kind: 'completion', id: 'after', calls: [] }] } };
  const session = { messages: [message] };
  assert.deepEqual(sourcesBefore(session, message, 'before'), []);
  assert.equal(sourcesBefore(session, message, 'after').length, 1);
  const later = { id: 'later', attempt: { includedMessageIds: [], steps: [] } }; session.messages.push(later);
  assert.equal(sourcesBefore(session, later).length, 0);
  later.attempt.includedMessageIds = ['m']; assert.equal(sourcesBefore(session, later).length, 1);
  message.attempt.steps[0].calls.push({ id: 'unfinished' }); assert.equal(sourcesBefore(session, later).length, 0);
  assert.equal(webUsage(message), 'Web credits: 0.2');
  message.attempt.steps[0].calls.push({ id: 'failed', name: 'read_web_page' }); assert.equal(webUsage(message), 'Web credits: 0.2 (incomplete)');
});
