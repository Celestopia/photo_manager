const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function safeText(value) {
  return String(value ?? '')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|authorization|access[_-]?token|secret|password)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]')
    .slice(0, 8192);
}
function formatLog(level, event, fields = {}) {
  if (Number.isFinite(fields.processed) && Number.isFinite(fields.total)) {
    const { processed, total, ...rest } = fields;
    fields = { ...rest, progress: `${processed}/${total}` };
  }
  return `${level.toUpperCase()} event=${JSON.stringify(event)} ` + Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${typeof value === 'number' || typeof value === 'boolean' || (key === 'progress' && /^\d+\/\d+$/.test(value)) ? value : JSON.stringify(safeText(value))}`).join(' ');
}
function appendDailyLog(directory, message) {
  try {
    const stamp = new Date().toISOString();
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(path.join(directory, `${stamp.slice(0, 10)}.log`), `[${stamp}] ${safeText(message).replace(/\r/g, '\\r').replace(/\n/g, '\\n')}\n`);
  } catch { /* Logging must not prevent recovery or shutdown. */ }
}
function createOperationLog({ operation, version, options = {}, write, now = Date.now }) {
  const run = randomUUID();
  const start = now();
  let last = -Infinity, phase, ended = false, warnings = 0, errors = 0;
  const record = (level, event, fields) => write(formatLog(level, event, { operation, run, ...fields }));
  record('info', 'start', { version, force: Boolean(options.force), reprobe: Boolean(options.reprobe) });
  return {
    progress(message) {
      if (ended) return;
      const level = message.level || 'info';
      if (level === 'warning' || level === 'warn') warnings++;
      if (level === 'error') errors++;
      if (!message.level && message.phase === phase && now() - last < 2000 && !(message.total !== undefined && message.processed === message.total)) return;
      if (!message.level) { last = now(); phase = message.phase; }
      const fields = {};
      for (const key of ['phase', 'processed', 'total', 'current', 'generated', 'skipped', 'failed', 'sourceChanged', 'message']) {
        if (message[key] !== undefined) fields[key] = message[key];
      }
      record(level, message.level ? 'message' : 'progress', { ...fields, elapsedMs: now() - start });
    },
    output(stream, text) { if (!ended) record('warning', 'worker-output', { stream, message: text }); },
    finish(result, failure, code, signal) {
      if (ended) return;
      ended = true;
      if (failure || code !== 0 || !result) {
        record('error', 'failed', { code: failure?.code || 'WORKER_EXIT', exitCode: code, signal, message: failure?.message, stack: failure?.stack, elapsedMs: now() - start });
        return;
      }
      const counts = Object.fromEntries(Object.entries(result).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)));
      warnings = Math.max(warnings, result.warnings?.length || 0);
      errors = Math.max(errors, result.errors?.length || 0);
      record('info', 'complete', { ...counts, warnings, errors, outcome: warnings || errors || result.failed || result.sourceChanged ? 'partial' : 'success', elapsedMs: now() - start });
    },
  };
}
module.exports = { safeText, formatLog, appendDailyLog, createOperationLog };
