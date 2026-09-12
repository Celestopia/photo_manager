const test = require("node:test");
const assert = require("node:assert/strict");
const { createLibraryClaimRegistry } = require("../src/main/library-claim-registry.js");

function session() {
  return { claimedLibraryId: null, runtime: { activeLibrary: null } };
}

test("library identity claims reject copied roots in different windows", () => {
  const registry = createLibraryClaimRegistry();
  const first = session();
  const second = session();
  const manifest = { libraryId: "00000000-0000-4000-8000-000000000001" };
  registry.claim(first, manifest, "D:\\Photos");
  assert.throws(
    () => registry.claim(second, manifest, "E:\\Copied Photos"),
    (error) => error.code === "LIBRARY_LOCKED" && error.lockState.forceAllowed === false,
  );
  assert.equal(registry.release(first), true);
  registry.claim(second, manifest, "E:\\Copied Photos");
  assert.equal(registry.release(second), true);
});
