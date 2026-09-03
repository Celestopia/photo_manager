const fsp = require("node:fs/promises");
const path = require("node:path");

const EMPTY_APPLICATION_STATE = Object.freeze({ lastLibraryPath: "" });

function normalizeApplicationState(value) {
  return {
    lastLibraryPath: typeof value?.lastLibraryPath === "string" ? value.lastLibraryPath : "",
  };
}

async function loadApplicationState(filePath) {
  try {
    return normalizeApplicationState(JSON.parse(await fsp.readFile(filePath, "utf8")));
  } catch {
    return { ...EMPTY_APPLICATION_STATE };
  }
}

async function saveApplicationState(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, `${JSON.stringify(normalizeApplicationState(value), null, 2)}\n`, "utf8");
    await fsp.rename(temporaryPath, filePath);
  } finally {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

module.exports = {
  EMPTY_APPLICATION_STATE,
  normalizeApplicationState,
  loadApplicationState,
  saveApplicationState,
};
