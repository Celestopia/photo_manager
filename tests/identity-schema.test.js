const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createEntityId,
  createUniqueEntityId,
  isUuidV4,
} = require("../src/shared/identity-schema.js");
const {
  validateLocationRegistryEntries,
  validateMediaEntries,
  validateGlobalEntityIdUniqueness,
  validateSimpleRegistryEntries,
} = require("../src/shared/library-data-schema.js");

const IDS = {
  mediaA: "00000000-0000-4000-8000-000000000001",
  mediaB: "00000000-0000-4000-8000-000000000002",
  tag: "00000000-0000-4000-8000-000000000003",
  album: "00000000-0000-4000-8000-000000000004",
  person: "00000000-0000-4000-8000-000000000005",
  locationA: "00000000-0000-4000-8000-000000000006",
  locationB: "00000000-0000-4000-8000-000000000007",
  locationC: "00000000-0000-4000-8000-000000000008",
  unknown: "00000000-0000-4000-8000-000000000009",
};

const NOW = "2026-07-16T00:00:00.000Z";

function simpleDefinition(idKey, id, labelKey, label) {
  return {
    [idKey]: id,
    [labelKey]: label,
    Description: "",
    CreatedAt: NOW,
    UpdatedAt: NOW,
  };
}

function media(overrides = {}) {
  return {
    MediaId: IDS.mediaA,
    FilePath: "a.jpg",
    Customization: {
      Title: "",
      Rating: 2,
      Privacy: 1,
      AlbumId: IDS.album,
      TagIds: [IDS.tag],
      PersonIds: [IDS.person],
      Description: "",
      PrivateNote: "",
    },
    Location: { LocationId: IDS.locationA, Detail: "" },
    ...overrides,
  };
}

function registries() {
  return {
    tags: validateSimpleRegistryEntries([
      simpleDefinition("TagId", IDS.tag, "Text", "美食"),
    ], { idKey: "TagId", labelKey: "Text", kind: "Tag" }),
    albums: validateSimpleRegistryEntries([
      simpleDefinition("AlbumId", IDS.album, "Title", "Camera"),
    ], { idKey: "AlbumId", labelKey: "Title", kind: "Album" }),
    people: validateSimpleRegistryEntries([
      simpleDefinition("PersonId", IDS.person, "Name", "我"),
    ], { idKey: "PersonId", labelKey: "Name", kind: "Person" }),
    locations: validateLocationRegistryEntries([
      {
        LocationId: IDS.locationA,
        Name: "清华大学",
        Country: "中国",
        Province: "",
        City: "北京",
        ParentId: null,
        Description: "",
        CreatedAt: NOW,
        UpdatedAt: NOW,
      },
    ]),
  };
}

test("entity IDs are lowercase UUID v4 values", () => {
  const first = createEntityId();
  const second = createEntityId();
  assert.equal(isUuidV4(first), true);
  assert.equal(isUuidV4(second), true);
  assert.notEqual(first, second);
  assert.equal(first, first.toLowerCase());
  assert.equal(isUuidV4(createUniqueEntityId((id) => id === first)), true);
});

test("simple registries require unique IDs and globally unique display names", () => {
  const first = simpleDefinition("TagId", IDS.tag, "Text", "美食");
  assert.throws(() => validateSimpleRegistryEntries([
    first,
    simpleDefinition("TagId", IDS.unknown, "Text", "美食"),
  ], { idKey: "TagId", labelKey: "Text", kind: "Tag" }), /duplicate Text/);
  assert.throws(() => validateSimpleRegistryEntries([
    first,
    simpleDefinition("TagId", IDS.tag, "Text", "食堂"),
  ], { idKey: "TagId", labelKey: "Text", kind: "Tag" }), /duplicate TagId/);
});

test("locations allow the same name in distinct contexts but reject exact duplicates", () => {
  const base = {
    Name: "和府捞面",
    Country: "中国",
    Province: "江苏",
    City: "南京",
    ParentId: null,
    Description: "",
    CreatedAt: NOW,
    UpdatedAt: NOW,
  };
  const valid = validateLocationRegistryEntries([
    { ...base, LocationId: IDS.locationA },
    { ...base, LocationId: IDS.locationB, City: "北京" },
  ]);
  assert.equal(valid.byId.size, 2);
  assert.throws(() => validateLocationRegistryEntries([
    { ...base, LocationId: IDS.locationA },
    { ...base, LocationId: IDS.locationB },
  ]), /duplicate location context/);
});

test("location registries reject unknown parents and parent cycles", () => {
  const definition = (LocationId, Name, ParentId) => ({
    LocationId,
    Name,
    Country: "中国",
    Province: "",
    City: "北京",
    ParentId,
    Description: "",
    CreatedAt: NOW,
    UpdatedAt: NOW,
  });
  assert.throws(() => validateLocationRegistryEntries([
    definition(IDS.locationA, "清华大学", IDS.unknown),
  ]), /Unknown ParentId/);
  assert.throws(() => validateLocationRegistryEntries([
    definition(IDS.locationA, "甲", IDS.locationB),
    definition(IDS.locationB, "乙", IDS.locationA),
  ]), /cycle/);
});

test("media validation accepts ID references and rejects unknown references", () => {
  const indexes = registries();
  const result = validateMediaEntries([media()], indexes);
  assert.equal(result.byId.get(IDS.mediaA).FilePath, "a.jpg");
  assert.throws(() => validateMediaEntries([
    media({ Customization: { ...media().Customization, TagIds: [IDS.unknown] } }),
  ], indexes), /Unknown TagId/);
});

test("media validation rejects duplicate MediaId and FilePath values", () => {
  const indexes = registries();
  assert.throws(() => validateMediaEntries([
    media(),
    media({ FilePath: "b.jpg" }),
  ], indexes), /duplicate MediaId/);
  assert.throws(() => validateMediaEntries([
    media(),
    media({ MediaId: IDS.mediaB }),
  ], indexes), /duplicate FilePath/);
});

test("entity IDs must be unique across all registry kinds and media", () => {
  const indexes = registries();
  assert.throws(() => validateGlobalEntityIdUniqueness({
    ...indexes,
    people: new Map([[IDS.tag, {}]]),
  }), /Global entity ID collision/);
  assert.throws(() => validateMediaEntries([
    media({ MediaId: IDS.tag }),
  ], indexes), /Global entity ID collision/);
});

test("fixed ID reference fields cannot be omitted", () => {
  const indexes = registries();
  const withoutAlbum = media();
  delete withoutAlbum.Customization.AlbumId;
  assert.throws(() => validateMediaEntries([withoutAlbum], indexes), /Customization\.AlbumId is required/);

  const withoutLocation = media();
  delete withoutLocation.Location.LocationId;
  assert.throws(() => validateMediaEntries([withoutLocation], indexes), /LocationId is required/);

  const emptyReferences = media();
  emptyReferences.Customization.AlbumId = "";
  emptyReferences.Location.LocationId = "";
  assert.throws(() => validateMediaEntries([emptyReferences], indexes), /AlbumId.*must be null/);
});
