const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isValidPrivacy,
  assertPrivacy,
  assertCustomization,
} = require("../src/shared/customization-schema");
const { createMetadataEditService } = require("../src/main/metadata-edit-service");

const MEDIA_A = "00000000-0000-4000-8000-000000000001";
const MEDIA_B = "00000000-0000-4000-8000-000000000002";

function customization(privacy) {
  return { Privacy: privacy, AlbumId: null, TagIds: [], PersonIds: [] };
}

function createEditService(metadata) {
  return createMetadataEditService({
    getMetadata: () => metadata,
    requireOpenLibrary() {},
    normalizeRegisteredTags: (tagIds) => ({ tagIds, unknown: [] }),
    normalizeRegisteredAlbum: (albumId) => ({ albumId, unknown: [] }),
    normalizeRegisteredPeople: (personIds) => ({ personIds, unknown: [] }),
    normalizeRegisteredLocation: (location) => ({ location, unknown: [] }),
    normalizeLocationObject: (location) => location || { LocationId: null, Detail: "" },
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
  assert.throws(() => assertCustomization(customization(0), "image.jpg"), /image\.jpg/);
});

test("single and batch metadata edits persist valid Privacy levels", async () => {
  const metadata = new Map([
    [MEDIA_A, { MediaId: MEDIA_A, FilePath: "a.jpg", Customization: customization(1), Location: { LocationId: null, Detail: "" } }],
    [MEDIA_B, { MediaId: MEDIA_B, FilePath: "b.jpg", Customization: customization(2), Location: { LocationId: null, Detail: "" } }],
  ]);
  const service = createEditService(metadata);

  const single = await service.updateCustomization({ mediaId: MEDIA_A, customization: { Privacy: 5 } });
  assert.equal(single.ok, true);
  assert.equal(metadata.get(MEDIA_A).Customization.Privacy, 5);

  const batch = await service.batchUpdate({ mediaIds: [MEDIA_A, MEDIA_B], customizationPatch: { Privacy: 3 } });
  assert.equal(batch.ok, true);
  assert.deepEqual([...metadata.values()].map((item) => item.Customization.Privacy), [3, 3]);
});

test("metadata edit service rejects invalid Privacy without changing data", async () => {
  const item = { MediaId: MEDIA_A, FilePath: "a.jpg", Customization: customization(1), Location: { LocationId: null, Detail: "" } };
  const metadata = new Map([[item.MediaId, item]]);
  const service = createEditService(metadata);

  const single = await service.updateCustomization({ mediaId: MEDIA_A, customization: { Privacy: "5" } });
  assert.equal(single.ok, false);
  assert.equal(metadata.get(MEDIA_A).Customization.Privacy, 1);

  const batch = await service.batchUpdate({ mediaIds: [MEDIA_A], customizationPatch: { Privacy: 0 } });
  assert.equal(batch.ok, false);
  assert.equal(metadata.get(MEDIA_A).Customization.Privacy, 1);
});
