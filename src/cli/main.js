const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline/promises');
const { parseCommand, help, usage } = require('./arguments');
const { outputResult, write } = require('./output');
const { resolveLibraryPaths, readLibraryManifest, findParentManagerDirectory } = require('../core/library-core');
const { resolveApplicationPaths } = require('../core/application-paths');
const { loadConfig } = require('../core/application-config');
const { createOperationLog, appendDailyLog } = require('../core/operation-log');
const { version } = require('../../package.json');

const OPERATIONS = { 'library init': 'init-metadata', 'maintenance update': 'update-metadata',
  'maintenance verify': 'verify-metadata', 'maintenance thumbnails': 'build-thumbnails',
  'maintenance video-covers': 'build-video-covers', 'export csv': 'export-metadata-csv' };

function validateExportTarget(paths, output) {
  const target = path.resolve(output || path.join(paths.dataDir, 'photo_metadata.csv'));
  // Reject links in existing components, including the output file itself.
  for (let current = target; ; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw usage('CSV output cannot use symbolic links');
    if (path.dirname(current) === current) break;
  }
  const key = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const defaultFile = path.join(paths.dataDir, 'photo_metadata.csv');
  if (key(target) !== key(defaultFile) && findParentManagerDirectory(target)) throw usage('Custom CSV output must be outside every Photo Manager library');
  return target;
}

async function runCli(argv, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr,
  signal = new AbortController().signal, environment = process.env } = {}) {
  let format = 'text', log, close;
  try {
    const parsed = parseCommand(argv);
    if (parsed.version) { await write(stdout, `Photo Manager ${version}\n`); return 0; }
    if (parsed.help) { await write(stdout, help(parsed.command)); return 0; }
    const { command, values } = parsed;
    format = values.format || 'text';
    signal.throwIfAborted();
    const paths = resolveLibraryPaths(values.library);
    const appPaths = resolveApplicationPaths(environment);
    const { config, warning } = loadConfig(appPaths.configFile);
    if (warning) await write(stderr, warning + '\n');
    const appendLog = message => appendDailyLog(fs.existsSync(paths.managerDir) ? paths.logDir : appPaths.logsDir, message);
    // Read-only queries/dry runs do not create operation logs inside the library.
    const isRead = command === 'library info' || / (list|show)$/.test(command) || values['dry-run'];
    if (!isRead) log = createOperationLog({ operation: `cli:${command}`, version,
      options: { force: values.force, reprobe: values.probe }, write: appendLog });
    const confirm = async (message, yes) => {
      signal.throwIfAborted();
      if (yes) return;
      if (!stdin.isTTY || !stderr.isTTY) throw usage(`${message} Rerun with --yes to confirm in noninteractive mode.`);
      const terminal = readline.createInterface({ input: stdin, output: stderr });
      try {
        const answer = await terminal.question(`${message} [y/N] `, { signal });
        if (!/^y(es)?$/i.test(answer.trim())) throw Object.assign(new Error('Cancelled'), { code: 'OPERATION_CANCELLED' });
      } finally { terminal.close(); }
    };
    let lastProgress = 0, phase;
    const onProgress = message => {
      log?.progress(message);
      if (!message.level && phase === message.phase && Date.now() - lastProgress < 1000) return;
      phase = message.phase; lastProgress = Date.now();
      const text = message.message || [message.phase, message.total === undefined ? '' : `progress=${message.processed ?? 0}/${message.total}`, message.current || ''].filter(Boolean).join(' ');
      stderr.write(text.replace(/[\r\n]/g, ' ') + '\n');
    };
    const context = { signal, confirm };
    let result;
    if (command === 'library unlock') {
      await readLibraryManifest(paths);
      const { inspectLibraryLock, releaseLibraryLock } = require('../core/library-lock');
      const status = await inspectLibraryLock(paths);
      if (!status.exists) result = { unlocked: false, message: 'Library is not locked' };
      else {
        if (status.active) throw Object.assign(new Error('An active library lock cannot be removed'), { code: 'LIBRARY_LOCKED' });
        if (!status.sameHost || !status.lock?.SessionId) throw new Error('Cannot establish that this lock is stale on this computer. Inspect its ownership manually.');
        await confirm(`Remove stale library lock owned by ${status.lock.HostName}, PID ${status.lock.ProcessId}?`, values.yes);
        const latest = await inspectLibraryLock(paths);
        if (latest.active || latest.lock?.SessionId !== status.lock.SessionId) throw new Error('Library lock changed; nothing removed');
        result = { unlocked: await releaseLibraryLock(paths, status.lock.SessionId) };
      }
    } else if (command === 'library recover') {
      const { validateExistingLibrary } = require('../core/library-access');
      const { acquireLibraryLock, releaseLibraryLock } = require('../core/library-lock');
      const { recoverLibraryTransactions } = require('../core/library-recovery');
      const manifest = await validateExistingLibrary(paths, { allowIncompleteData: true, signal });
      const lock = await acquireLibraryLock(paths, manifest);
      close = () => releaseLibraryLock(paths, lock.SessionId);
      await confirm('Recover pending library transactions?', values.yes);
      signal.throwIfAborted();
      result = await recoverLibraryTransactions(paths, appendLog);
    } else if (OPERATIONS[command]) {
      if (command === 'library init') await confirm('Initialize this folder? This scans and hashes media and creates .photo_manager; original media are unchanged.', values.yes);
      if (command === 'export csv') {
        const target = validateExportTarget(paths, values.output);
        values.output = target;
        if (fs.existsSync(target)) await confirm(`Overwrite CSV ${target}?`, values.yes);
      }
      signal.throwIfAborted();
      result = await require('../core/' + OPERATIONS[command]).run({ paths, config, name: values.name,
        force: Boolean(values.force), reprobe: Boolean(values.probe), outputFile: values.output,
        signal, onProgress, logger: { info() {}, warn() {}, error() {} } });
    } else {
      const session = await require('../core/library-session').openLibrarySession({ paths, config, appendLog, signal });
      close = session.close;
      signal.throwIfAborted();
      result = await require('./commands').sessionCommand(command, values, session, context);
    }
    const findings = command === 'maintenance verify' && ['missing', 'extra', 'tampered', 'typeMismatch', 'probeFailed', 'probeChanged', 'readFailed', 'privacyInvalid'].some(key => result[key] > 0);
    const partial = findings || result.failed > 0 || result.sourceChanged > 0 || result.errors?.length > 0;
    if (close) { const release = close; close = null; await release(); }
    log?.finish(result, null, partial ? 4 : 0, null);
    await outputResult(result, format, stdout, stderr);
    return partial ? 4 : 0;
  } catch (error) {
    if (close) {
      try { await close(); }
      catch (cleanup) { error.message += `; could not release library lock: ${cleanup.message}`; }
      close = null;
    }
    const cancelled = error.code === 'OPERATION_CANCELLED' || error.name === 'AbortError';
    const code = cancelled ? 130 : error.exitCode || (['LIBRARY_LOCKED', 'LIBRARY_LOCK_ACTIVE'].includes(error.code) ? 3 : error.code === 'RECOVERY_REQUIRED' ? 5 : 1);
    log?.finish(null, error, code, null);
    await write(stderr, format === 'text' ? `${error.code || 'ERROR'}: ${error.message}${error.candidates ? '\n' + JSON.stringify(error.candidates, null, 2) : ''}\n`
      : JSON.stringify({ error: { code: error.code || (cancelled ? 'OPERATION_CANCELLED' : 'OPERATION_FAILED'), message: error.message, ...(error.candidates ? { candidates: error.candidates } : {}) } }) + '\n');
    return code;
  }
}
async function main(argv = process.argv.slice(2)) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  const brokenPipe = error => { if (error.code === 'EPIPE') controller.abort(); };
  process.stdout.on('error', brokenPipe);
  try { process.exitCode = await runCli(argv, { signal: controller.signal }); }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); process.stdout.removeListener('error', brokenPipe); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { runCli, main };
