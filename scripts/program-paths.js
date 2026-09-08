const path = require("node:path");

const PROGRAM_RESOURCE_ROOT_ENV = "PHOTO_MANAGER_RESOURCE_ROOT";
const DEFAULT_PROGRAM_RESOURCE_ROOT = path.resolve(__dirname, "..");

function resolveProgramResourceRoot(options = {}) {
  const environment = options.environment || process.env;
  const configuredRoot = String(environment?.[PROGRAM_RESOURCE_ROOT_ENV] || "").trim();
  return path.resolve(configuredRoot || options.defaultRoot || DEFAULT_PROGRAM_RESOURCE_ROOT);
}

module.exports = {
  PROGRAM_RESOURCE_ROOT_ENV,
  DEFAULT_PROGRAM_RESOURCE_ROOT,
  resolveProgramResourceRoot,
};
