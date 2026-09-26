const { parseArgs } = require('node:util');

const COMMON = ['library', 'format', 'help'];
const FILTERS = ['type', 'rating', 'privacy', 'album', 'tag', 'person', 'location', 'album-name', 'tag-name',
  'person-name', 'location-name', 'country', 'province', 'city', 'regions-file', 'search', 'search-field', 'order'];
const EDIT = ['id', 'ids-file', 'patch-file', 'title', 'description', 'hidden-description', 'rating', 'privacy',
  'album', 'tag', 'person', 'location', 'detail', 'add-tag', 'remove-tag', 'add-person', 'remove-person',
  'clear-album', 'clear-tags', 'clear-people', 'clear-location', 'dry-run', 'yes'];
const REGISTRY = ['id', 'name', 'description', 'country', 'province', 'city', 'parent', 'clear-parent'];
const COMMANDS = {
  'library init': ['name', 'yes'], 'library info': [], 'library rename': ['name'],
  'library recover': ['yes'], 'library unlock': ['yes'],
  'media list': [...FILTERS, 'limit', 'offset', 'fields'], 'media show': ['id'], 'media edit': EDIT,
  'maintenance update': [], 'maintenance verify': ['probe'], 'maintenance thumbnails': ['force'],
  'maintenance video-covers': ['force'], 'export csv': ['output', 'yes'],
};
for (const kind of ['album', 'tag', 'person', 'location']) {
  for (const action of ['list', 'show', 'create', 'update', 'delete']) {
    COMMANDS[`registry ${kind} ${action}`] = action === 'list' ? [] : action === 'show' ? ['id']
      : action === 'delete' ? ['id', 'dry-run', 'yes']
      : REGISTRY.filter(key => (kind === 'location' || !['country', 'province', 'city', 'parent', 'clear-parent'].includes(key))
        && (action === 'update' || key !== 'id'));
  }
}
const BOOLEANS = new Set(['help', 'version', 'yes', 'force', 'probe', 'dry-run', 'clear-album', 'clear-tags', 'clear-people', 'clear-location', 'clear-parent']);
const REPEAT = new Set(['id', 'rating', 'privacy', 'album', 'tag', 'person', 'location', 'album-name', 'tag-name',
  'person-name', 'location-name', 'add-tag', 'remove-tag', 'add-person', 'remove-person']);
function usage(message) { return Object.assign(new Error(message), { code: 'USAGE', exitCode: 2 }); }
function parseCommand(argv) {
  const keys = new Set([...COMMON, 'version', ...Object.values(COMMANDS).flat()]);
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, tokens: true,
      options: Object.fromEntries([...keys].map(key => [key, { type: BOOLEANS.has(key) ? 'boolean' : 'string',
        ...(REPEAT.has(key) ? { multiple: true } : {}), ...(key === 'help' ? { short: 'h' } : {}) }])) });
  } catch (error) { throw usage(error.message); }
  const { values, positionals, tokens } = parsed;
  for (const key of keys) {
    if (!REPEAT.has(key) && tokens.filter(token => token.kind === 'option' && token.name === key).length > 1) throw usage(`Repeated option: --${key}`);
  }
  if (values.version) {
    if (positionals.length || Object.keys(values).length !== 1) throw usage('--version must be used alone');
    return { version: true };
  }
  const command = positionals.join(' ');
  if (values.help || !argv.length) {
    if (command && !Object.keys(COMMANDS).some(key => key === command || key.startsWith(command + ' '))) throw usage(`Unknown command: ${command}`);
    return { help: true, command };
  }
  if (!COMMANDS[command]) throw usage(`Unknown command: ${command || '(missing)'}. Run ptmgr --help.`);
  const allowed = new Set([...COMMON, ...COMMANDS[command]]);
  for (const key of Object.keys(values)) if (!allowed.has(key)) throw usage(`--${key} is not supported by ${command}`);
  if (!values.library?.trim()) throw usage('--library <folder> is required');
  if (!['text', 'json', 'jsonl'].includes(values.format || 'text')) throw usage('--format must be text, json, or jsonl');
  return { command, values };
}
function one(value, label, required = false) {
  const items = Array.isArray(value) ? value : value === undefined ? [] : [value];
  if (items.length > 1 || (required && !items.length)) throw usage(`Supply exactly one --${label}`);
  return items[0];
}
function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw usage(`--${label} must be an integer from ${min} to ${max}`);
  return Number(value);
}
function help(command = '') {
  const selected = Object.keys(COMMANDS).filter(key => !command || key === command || key.startsWith(command + ' '));
  return ['Photo Manager CLI', '', 'Usage: ptmgr <group> <command> --library <folder> [options]', '',
    ...selected.map(key => `  ${key}${COMMANDS[key].length ? '\n    ' + COMMANDS[key].map(option => `--${option}${BOOLEANS.has(option) ? '' : ' <value>'}`).join(' ') : ''}`),
    '', 'Global: --library <folder>  --format text|json|jsonl  --help  --version',
    'Repeat registry/rating/privacy filters for OR; different fields combine with AND.',
    'Registry filters accept UUIDs or unassigned; use --tag-name etc. for exact names.',
    'All privacy levels are included by default. Close this library in the GUI first.',
    'Use --dry-run to preview media edits and registry deletions; --yes confirms automation.',
    'See docs/cli/ for patch-file schemas, examples, exit codes, and cancellation behavior.', ''].join('\n');
}
module.exports = { parseCommand, help, usage, one, integer };
