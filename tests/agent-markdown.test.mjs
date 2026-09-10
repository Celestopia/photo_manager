import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAgentMarkdown } from '../src/renderer/domain/agent-markdown.mjs';

test('assistant Markdown renders Chinese emphasis, lists, headings and tables', () => {
  const html = renderAgentMarkdown('## 照片介绍\n\n这里是**首钢园**。\n\n* **主体建筑**：三高炉\n* 细节\n\n| 名称 | 值 |\n| --- | --- |\n| 地点 | 北京 |');
  assert.match(html, /<h2>照片介绍<\/h2>/);
  assert.match(html, /<strong>首钢园<\/strong>/);
  assert.match(html, /<ul>\s*<li><strong>主体建筑<\/strong>/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /\*\*首钢园\*\*/);
});

test('streaming incomplete fences remain escaped and rerender when complete', () => {
  const partial = renderAgentMarkdown('```html\n<img src=x onerror=alert(1)>');
  const complete = renderAgentMarkdown('```html\n<img src=x onerror=alert(1)>\n```\n\n**Done**');
  assert.match(partial, /<pre><code/);
  assert.match(partial, /&lt;img/);
  assert.doesNotMatch(partial, /<img/);
  assert.match(complete, /<strong>Done<\/strong>/);
});

test('model HTML, links and images cannot execute, navigate or fetch remote assets', () => {
  const html = renderAgentMarkdown('<script>alert(1)</script>\n\n<img src="https://example.com/private" onerror="alert(1)">\n\n![Photo](https://example.com/tracker)\n\n[Read](https://example.com)\n\n[Run](javascript:alert(1))');
  assert.doesNotMatch(html, /<(script|img|a|iframe|svg)\b/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<span class="agent-markdown-link" title="https:\/\/example.com">Read<\/span>/);
  assert.match(html, /Photo/);
});
