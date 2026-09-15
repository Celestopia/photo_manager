const { isIP } = require('node:net');
const { exact, str, uuid } = require('./runtime');

function publicUrl(value) {
  str(value, 2048);
  if (!value || /[\s\\\u0000-\u001f]/u.test(value) || /%(?![0-9a-f]{2})/i.test(value)) throw new Error('Invalid public source URL');
  const url = new URL(value);
  const host = url.hostname.replace(/\.$/, '').toLowerCase();
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || isIP(host) || host.startsWith('[') || !host.includes('.')
    || /(^|\.)(localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(host)
    || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) throw new Error('Invalid public source URL');
  url.hash = '';
  url.hostname = host;
  return url.href;
}
function clip(value, bytes) {
  let result = '', size = 0;
  for (const character of String(value)) {
    const n = Buffer.byteLength(character);
    if (size + n > bytes) break;
    result += character;
    size += n;
  }
  return result;
}
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Invalid retrieval timestamp');
}
function common(value, keys) {
  exact(value, keys);
  if (value.status !== 'success' || value.provider !== 'tavily' || typeof value.truncated !== 'boolean') throw new Error('Invalid web result');
  timestamp(value.retrievedAt);
  if (value.credits !== null && (!Number.isFinite(value.credits) || value.credits < 0)) throw new Error('Invalid web usage');
}
function validateSearch(value) {
  common(value, ['status', 'provider', 'retrievedAt', 'sources', 'discardedCount', 'truncated', 'credits']);
  if (!Array.isArray(value.sources) || value.sources.length > 5 || !Number.isSafeInteger(value.discardedCount) || value.discardedCount < 0) throw new Error('Invalid search sources');
  const urls = new Set();
  for (const source of value.sources) {
    exact(source, ['sourceId', 'title', 'url', 'excerpt', 'publishedAt', 'truncated']);
    uuid(source.sourceId); str(source.title, 300); str(source.excerpt, 1024);
    if (Buffer.byteLength(source.excerpt) > 1024 || publicUrl(source.url) !== source.url || urls.has(source.url) || typeof source.truncated !== 'boolean') throw new Error('Invalid search source');
    urls.add(source.url);
    if (source.publishedAt !== null) timestamp(source.publishedAt);
  }
}
function validateRead(value) {
  common(value, ['status', 'provider', 'retrievedAt', 'sourceId', 'text', 'truncated', 'credits']);
  uuid(value.sourceId); str(value.text, 10240);
  if (Buffer.byteLength(value.text) > 10240) throw new Error('Page text exceeds limit');
}
function sourcesOf(session) {
  return session.messages.flatMap(m => (m.attempt?.steps || []).flatMap(step => step.kind === 'tool' && step.outcome.status === 'success' ? step.outcome.sources || [] : []));
}
module.exports = { publicUrl, clip, validateSearch, validateRead, sourcesOf };
