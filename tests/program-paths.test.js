const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  PROGRAM_RESOURCE_ROOT_ENV,
  resolveProgramResourceRoot,
} = require("../scripts/program-paths.js");

test("program resources use the explicit packaged root when provided", () => {
  const packagedRoot = path.join("C:\\", "Program Files", "PhotoManager", "resources");
  assert.equal(
    resolveProgramResourceRoot({ environment: { [PROGRAM_RESOURCE_ROOT_ENV]: packagedRoot } }),
    path.resolve(packagedRoot),
  );
});

test("program resources fall back to the development root", () => {
  const developmentRoot = path.join("F:\\", "Projects", "photo_manager");
  assert.equal(
    resolveProgramResourceRoot({ environment: {}, defaultRoot: developmentRoot }),
    path.resolve(developmentRoot),
  );
});
