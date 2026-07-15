const test = require("node:test");
const assert = require("node:assert/strict");

const { applyConfigPatch } = require("../src/main/application-config.js");
const { createApplicationRuntime } = require("../src/main/application-runtime.js");
const { createGalleryQueryService } = require("../src/main/gallery-query.js");
const { createLocationDomain } = require("../src/main/location-domain.js");
const { createSimpleRegistryCatalog } = require("../src/main/simple-registry-catalog.js");

const IDS = {
  campus: "00000000-0000-4000-8000-000000000001",
  dining: "00000000-0000-4000-8000-000000000002",
  floor: "00000000-0000-4000-8000-000000000003",
  other: "00000000-0000-4000-8000-000000000004",
  tag: "00000000-0000-4000-8000-000000000005",
  unknownTag: "00000000-0000-4000-8000-000000000006",
};

test("application config patches preserve nested settings and normalize bounded values", () => {
  const current = {
    thumbnail: { size: 320, webpQuality: 80 },
    media: { ffmpegDir: "tools" },
    backup: { retentionCount: 10 },
    ui: { gallery: { minCardWidth: 190 }, viewer: { zoom: { minPercent: 10, maxPercent: 1000 } } },
  };
  const result = applyConfigPatch(current, {
    backup: { retentionCount: 0 },
    ui: { gallery: { pageSize: 999 }, viewer: { zoom: { maxPercent: 800 } } },
  }, (media) => media);
  assert.equal(result.backup.retentionCount, 10);
  assert.deepEqual(result.ui.viewer.zoom, { minPercent: 10, maxPercent: 800 });
  assert.equal(result.ui.gallery.minCardWidth, 190);
  assert.equal(Object.hasOwn(result.ui.gallery, "pageSize"), false);
});

test("application runtime creates isolated mutable library sessions", () => {
  const first = createApplicationRuntime();
  const second = createApplicationRuntime();
  first.metadataIndex.set(IDS.campus, {});
  first.mediaPathIndex.set("a.jpg", IDS.campus);
  first.maintenanceState.running = true;
  assert.equal(second.metadataIndex.size, 0);
  assert.equal(second.mediaPathIndex.size, 0);
  assert.equal(second.maintenanceState.running, false);
});

test("location domain resolves ID-backed paths and rejects descendant parents", () => {
  const registry = new Map([
    [IDS.campus, { LocationId: IDS.campus, Name: "清华大学", ParentId: null }],
    [IDS.dining, { LocationId: IDS.dining, Name: "清芬园食堂", ParentId: IDS.campus }],
    [IDS.floor, { LocationId: IDS.floor, Name: "二层", ParentId: IDS.dining }],
  ]);
  const domain = createLocationDomain(() => registry);
  assert.deepEqual(domain.buildLocationPath(IDS.floor), ["清华大学", "清芬园食堂", "二层"]);
  assert.deepEqual(new Set(domain.getLocationDescendants(IDS.campus)), new Set([IDS.dining, IDS.floor]));
  assert.deepEqual(domain.validateLocationParent(IDS.campus, IDS.floor), {
    ok: false,
    error: "Parent cannot be a descendant location",
  });
});

test("gallery query composes descendant location ID filters with sorting", () => {
  const service = createGalleryQueryService({
    getLocationDescendants: (id) => id === IDS.campus ? [IDS.dining] : [],
    unassignedAlbumFilter: "__UNASSIGNED__",
  });
  const items = [
    { FilePath: "b.jpg", FileSystem: { ShootingTimeString: "2026-01-02" }, Location: { LocationId: IDS.dining }, Customization: { Rating: 2 } },
    { FilePath: "a.jpg", FileSystem: { ShootingTimeString: "2026-01-01" }, Location: { LocationId: IDS.other }, Customization: { Rating: 3 } },
  ];
  const result = service.filterAndSort(items, {
    filters: { mediaType: "", album: "", tag: "", person: "", location: IDS.campus },
    search: { field: "", value: "" }, sortBy: "filename", sortOrder: "asc",
  });
  assert.deepEqual(result.map((item) => item.FilePath), ["b.jpg"]);
});

test("gallery query groups the complete result without a page-size cutoff", () => {
  const service = createGalleryQueryService({ getLocationDescendants: () => [], unassignedAlbumFilter: "__UNASSIGNED__" });
  const items = Array.from({ length: 150 }, (_, index) => ({
    FilePath: `media-${String(index).padStart(3, "0")}.jpg`,
    __groupDate: index < 125 ? "2026-01-02" : "2026-01-01",
    FileSystem: { ShootingTimeString: index < 125 ? "2026-01-02" : "2026-01-01" },
    Customization: { Rating: 2 },
  }));
  const sorted = service.filterAndSort(items, {
    filters: { mediaType: "", album: "", tag: "", person: "", location: "" },
    search: { field: "", value: "" }, sortBy: "shootingTime", sortOrder: "desc",
  });
  const groups = service.groupByDate(sorted);
  assert.equal(groups.flatMap((group) => group.items).length, 150);
  assert.deepEqual(groups.map((group) => [group.date, group.items.length]), [["2026-01-02", 125], ["2026-01-01", 25]]);
});

test("gallery query includes every privacy level", () => {
  const service = createGalleryQueryService({ getLocationDescendants: () => [], unassignedAlbumFilter: "__UNASSIGNED__" });
  const items = [1, 2, 3, 4, 5].map((privacy) => ({
    FilePath: `privacy-${privacy}.jpg`, FileSystem: { ShootingTimeString: "2026-01-01" }, Customization: { Rating: 2, Privacy: privacy },
  }));
  const result = service.filterAndSort(items, {
    filters: { mediaType: "", album: "", tag: "", person: "", location: "" },
    search: { field: "", value: "" }, sortBy: "filename", sortOrder: "asc",
  });
  assert.equal(result.length, 5);
});

test("simple registry catalog deduplicates IDs and reports usage", () => {
  const now = "2026-01-01T00:00:00.000Z";
  const registry = new Map([[IDS.tag, { TagId: IDS.tag, Text: "美食", Description: "", CreatedAt: now, UpdatedAt: now }]]);
  const metadata = new Map([
    ["media-a", { Customization: { TagIds: [IDS.tag] } }],
    ["media-b", { Customization: { TagIds: [IDS.tag] } }],
  ]);
  const catalog = createSimpleRegistryCatalog({
    idKey: "TagId", definitionKey: "Text", dataFileName: "tag_registry.jsonl",
    backupReason: "test", normalize: (value) => String(value || "").trim(),
    extractReferences: (item) => item.Customization.TagIds,
    getRegistry: () => registry, getMetadata: () => metadata, resolveDataFile: () => "unused",
    prepareLibraryWrite: async () => {}, touchLibraryManifest: async () => {},
    readJsonlStrict: async () => [], writeJsonlAtomic: async () => {},
  });
  assert.deepEqual(catalog.validateMany([IDS.tag, IDS.tag, IDS.unknownTag]), {
    values: [IDS.tag, IDS.unknownTag], unknown: [IDS.unknownTag],
  });
  assert.equal(catalog.listDefinitions()[0].UsageCount, 2);
});
