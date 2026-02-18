/**
 * Robust Electron launcher for npm start.
 *
 * Some shells keep ELECTRON_RUN_AS_NODE in the environment, which breaks
 * app startup (Electron API becomes unavailable). This launcher normalizes
 * that variable before spawning the real Electron binary.
 */
const { spawn } = require("node:child_process");

const electronBinary = require("electron");
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ["."], {
  stdio: "inherit",
  env: childEnv,
});

child.on("error", (error) => {
  console.error(`Failed to launch Electron: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
