const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

function currentProcessStartedAt() {
  return new Date(Date.now() - process.uptime() * 1000).toISOString();
}

function isProcessAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

async function getProcessStartedAt(pid) {
  if (process.platform !== "win32" || !Number.isInteger(Number(pid)) || Number(pid) <= 0) return null;
  const command = `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      windowsHide: true,
      timeout: 3000,
      maxBuffer: 64 * 1024,
    });
    const value = String(stdout || "").trim();
    return Number.isFinite(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

async function readLock(lockFile) {
  try {
    return JSON.parse(await fsp.readFile(lockFile, "utf8"));
  } catch {
    return null;
  }
}

async function inspectLibraryLock(paths) {
  const lockFileExists = fs.existsSync(paths.lockFile);
  const lock = await readLock(paths.lockFile);
  if (!lock) return { exists: lockFileExists, active: false, forceAllowed: lockFileExists, lock: null };
  const sameHost = String(lock.HostName || "").toLowerCase() === os.hostname().toLowerCase();
  const pidAlive = sameHost && isProcessAlive(lock.ProcessId);
  const actualStartedAt = pidAlive ? await getProcessStartedAt(lock.ProcessId) : null;
  const recordedStartedAt = Date.parse(lock.ProcessStartedAt || "");
  const startMatches = !actualStartedAt || !Number.isFinite(recordedStartedAt)
    ? pidAlive
    : Math.abs(Date.parse(actualStartedAt) - recordedStartedAt) < 5000;
  const alive = pidAlive && startMatches;
  return {
    exists: true,
    active: alive,
    sameHost,
    forceAllowed: !alive,
    lock,
  };
}

async function acquireLibraryLock(paths, manifest, options = {}) {
  if (options.force) {
    const existing = await inspectLibraryLock(paths);
    if (existing.active) {
      const error = new Error("An active library lock cannot be forced open");
      error.code = "LIBRARY_LOCK_ACTIVE";
      error.lockState = existing;
      throw error;
    }
    await fsp.rm(paths.lockFile, { force: true });
  }
  const lock = {
    LibraryId: manifest.libraryId,
    SessionId: crypto.randomUUID(),
    ProcessId: process.pid,
    ProcessStartedAt: await getProcessStartedAt(process.pid) || currentProcessStartedAt(),
    HostName: os.hostname(),
    ApplicationStartedAt: options.applicationStartedAt || new Date().toISOString(),
  };
  let handle;
  try {
    handle = await fsp.open(paths.lockFile, "wx");
    await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`, "utf8");
  } catch (error) {
    const state = await inspectLibraryLock(paths);
    const detail = state.lock
      ? `${state.lock.HostName || "unknown host"}, PID ${state.lock.ProcessId || "unknown"}, ${state.lock.ApplicationStartedAt || "unknown time"}`
      : error.message;
    const lockError = new Error(`Library is locked by ${detail}`);
    lockError.code = "LIBRARY_LOCKED";
    lockError.lockState = state;
    throw lockError;
  } finally {
    await handle?.close().catch(() => {});
  }
  return lock;
}

async function releaseLibraryLock(paths, sessionId) {
  const current = await readLock(paths.lockFile);
  if (!current || current.SessionId !== sessionId) return false;
  await fsp.rm(paths.lockFile, { force: true });
  return true;
}

module.exports = {
  currentProcessStartedAt,
  isProcessAlive,
  getProcessStartedAt,
  readLock,
  inspectLibraryLock,
  acquireLibraryLock,
  releaseLibraryLock,
};
