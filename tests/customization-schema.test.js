const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isValidPrivacy,
  assertPrivacy,
  assertCustomization,
} = require("../src/shared/customization-schema");
const { createMetadataEditService } = require("../src/main/metadata-edit-service");

function createEditService(metadata) {
  return createMetadataEditService({
    getMetadata: () => metadata,
    requireOpenLibrary() {},
    normalizeRegisteredTags: (tags) => ({ tags, unknown: [] }),
    normalizeRegisteredAlbum: (album) => ({ album, unknown: [] }),
    normalizeRegisteredPeople: (people) => ({ people, unknown: [] }),
    normalizeRegisteredLocation: (location) => ({ location, unknown: [] }),
    normalizeLocationObject: (location) => location || { Place: "", Detail: "" },
    saveMetadata: async () => {},
    enrichItem: (item) => structuredClone(item),
    appendLog() {},
  });
}

test("Privacy accepts only integer levels from one through five", () => {
  for (const value of [1, 2, 3, 4, 5]) assert.equal(isValidPrivacy(value), true);
  for (const value of [null, "1", 0, 6, 2.5, Number.NaN]) assert.equal(isValidPrivacy(value), false);
  assert.equal(assertPrivacy(3), 3);
  assert.throws(() => assertPrivacy("3"), /integer from 1 to 5/);
  assert.throws(() => assertCustomization({ Privacy: 0 }, "image.jpg"), /image\.jpg/);
});

test("single and batch metadata edits persist valid Privacy levels", async () => {
  const metadata = new Map([
    ["a.jpg", { FilePath: "a.jpg", Customization: { Privacy: 1, Tags: [], People: [] }, Location: { Place: "", Detail: "" } }],
    ["b.jpg", { FilePath: "b.jpg", Customization: { Privacy: 2, Tags: [], People: [] }, Location: { Place: "", Detail: "" } }],
  ]);
  const service = createEditService(metadata);

  const single = await service.updateCustomization({ filePath: "a.jpg", customization: { Privacy: 5 } });
  assert.equal(single.ok, true);
  assert.equal(metadata.get("a.jpg").Customization.Privacy, 5);

  const batch = await service.batchUpdate({
    filePaths: ["a.jpg", "b.jpg"],
    customizationPatch: { Privacy: 3 },
  });
  assert.equal(batch.ok, true);
  assert.deepEqual([...metadata.values()].map((item) => item.Customization.Privacy), [3, 3]);
});

test("metadata edit service rejects invalid Privacy without changing data", async () => {
  const item = { FilePath: "a.jpg", Customization: { Privacy: 1, Tags: [], People: [] }, Location: { Place: "", Detail: "" } };
  const metadata = new Map([[item.FilePath, item]]);
  const service = createEditService(metadata);

  const single = await service.updateCustomization({ filePath: "a.jpg", customization: { Privacy: "5" } });
  assert.equal(single.ok, false);
  assert.equal(metadata.get("a.jpg").Customization.Privacy, 1);

  const batch = await service.batchUpdate({ filePaths: ["a.jpg"], customizationPatch: { Privacy: 0 } });
  assert.equal(batch.ok, false);
  assert.equal(metadata.get("a.jpg").Customization.Privacy, 1);
});
