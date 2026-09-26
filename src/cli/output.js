const { once } = require('node:events');

async function write(stream, text) {
  if (!stream.write(text)) await once(stream, 'drain');
}
const display = value => typeof value === 'object' ? JSON.stringify(value) : String(value ?? '').replace(/[\r\n\t]/g, ' ');
async function outputResult(result, format, stdout, stderr) {
  if (format === 'json') return write(stdout, JSON.stringify(result, null, 2) + '\n');
  const items = result.items;
  if (format === 'jsonl') {
    for (const item of items || [result]) await write(stdout, JSON.stringify(item) + '\n');
  } else if (Array.isArray(items)) {
    const keys = [...new Set(items.flatMap(item => Object.keys(item)))];
    if (keys.length) await write(stdout, keys.join('\t') + '\n');
    for (const item of items) await write(stdout, keys.map(key => display(item[key])).join('\t') + '\n');
  } else {
    await write(stdout, JSON.stringify(result, null, 2) + '\n');
  }
  if (Array.isArray(items)) await write(stderr, `${result.returned ?? items.length} returned; ${result.total ?? items.length} matched\n`);
}
module.exports = { outputResult, write };
