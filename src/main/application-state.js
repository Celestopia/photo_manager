const fsp = require("node:fs/promises");
const { writeTextAtomic } = require("../../scripts/library-core");

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
  await writeTextAtomic(filePath, `${JSON.stringify(normalizeApplicationState(value), null, 2)}\n`);
}

module.exports = {
  EMPTY_APPLICATION_STATE,
  normalizeApplicationState,
  loadApplicationState,
  saveApplicationState,
};
