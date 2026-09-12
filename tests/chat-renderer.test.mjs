import test from "node:test";
import assert from "node:assert/strict";
import { renderChatMarkdown } from "../src/renderer/domain/chat-markdown.mjs";
test("assistant Markdown formats Chinese emphasis, lists, tables and code without active content", () => {
  const html = renderChatMarkdown(
    "你好 **世界**\n\n- 海边\n- 公园\n\n<script>alert(1)</script>\n\n![private](https://tracker.example/pixel)\n\n[x](javascript:alert(1))\n\n```js\nconst x = 1;\n```",
  );
  assert.match(html, /<strong>世界<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<pre><code/);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("href="));
});
import { sessionUsage } from '../src/renderer/domain/chat-usage.mjs';
test('session usage sums completion attempts once and marks missing reports', () => {
  const messages = [{role:'user'}, {role:'assistant',attempt:{usage:{inputTotal:10,output:3,inputCacheHit:0,inputCacheMiss:10}}}, {role:'assistant',attempt:{retryOf:'prior',usage:{inputTotal:20,output:5,inputCacheHit:null,inputCacheMiss:null}}}];
  assert.deepEqual(sessionUsage(messages), {usage:{inputCacheHit:0,inputCacheMiss:10,inputTotal:30,output:8},incomplete:true});
});
