const test = require("node:test");
const assert = require("node:assert/strict");

const { applyConfigPatch } = require("../src/main/application-config.js");
const { createApplicationRuntime } = require("../src/main/application-runtime.js");
const { createGalleryQueryService } = require("../src/main/gallery-query.js");
const { createLocationDomain, normalizeLocationName } = require("../src/main/location-domain.js");
const { createSimpleRegistryCatalog } = require("../src/main/simple-registry-catalog.js");

test("application config patches preserve nested settings and normalize bounded values", () => {
  const current = {
    thumbnail: { size: 320, webpQuality: 80 },
    media: { ffmpegDir: "tools" },
    backup: { retentionCount: 10 },
    ui: { gallery: { pageSize: 120 }, viewer: { zoom: { minPercent: 10, maxPercent: 1000 } } },
  };
  const result = applyConfigPatch(current, {
    backup: { retentionCount: 0 },
    ui: { viewer: { zoom: { maxPercent: 800 } } },
  }, (media) => media);
  assert.equal(result.backup.retentionCount, 10);
  assert.deepEqual(result.ui.viewer.zoom, { minPercent: 10, maxPercent: 800 });
  assert.equal(result.ui.gallery.pageSize, 120);
});

test("application runtime creates isolated mutable library sessions", () => {
  const first = createApplicationRuntime();
  const second = createApplicationRuntime();
  first.metadataIndex.set("a.jpg", {});
  first.maintenanceState.running = true;
  assert.equal(second.metadataIndex.size, 0);
  assert.equal(second.maintenanceState.running, false);
});

test("location domain resolves paths and rejects descendant parents", () => {
  const registry = new Map([
    ["清华大学", { Name: "清华大学", Parent: "" }],
    ["清芬园食堂", { Name: "清芬园食堂", Parent: "清华大学" }],
    ["二层", { Name: "二层", Parent: "清芬园食堂" }],
  ]);
  const domain = createLocationDomain(() => registry);
  assert.deepEqual(domain.buildLocationPath("二层"), ["清华大学", "清芬园食堂", "二层"]);
  assert.deepEqual(new Set(domain.getLocationDescendants("清华大学")), new Set(["清芬园食堂", "二层"]));
  assert.deepEqual(domain.validateLocationParent("清华大学", "二层"), {
    ok: false,
    error: "Parent cannot be a descendant location",
  });
});

test("gallery query composes descendant location filters with sorting", () => {
  const service = createGalleryQueryService({
    getLocationDescendants: (name) => name === "清华大学" ? ["清芬园食堂"] : [],
    normalizeAlbumTitle: (value) => String(value || "").trim(),
    normalizeLocationName,
    unassignedAlbumFilter: "__UNASSIGNED__",
  });
  const items = [
    { FilePath: "b.jpg", FileSystem: { ShootingTimeString: "2026-01-02" }, Location: { Place: "清芬园食堂" }, Customization: { Rating: 2 } },
    { FilePath: "a.jpg", FileSystem: { ShootingTimeString: "2026-01-01" }, Location: { Place: "其它地点" }, Customization: { Rating: 3 } },
  ];
  const result = service.filterAndSort(items, {
    filters: { mediaType: "", album: "", tag: "", person: "", location: "清华大学" },
    search: { field: "", value: "" },
    sortBy: "filename",
    sortOrder: "asc",
  });
  assert.deepEqual(result.map((item) => item.FilePath), ["b.jpg"]);
});

test("simple registry catalog deduplicates values and reports usage", () => {
  const registry = new Map([
    ["美食", { Text: "美食", Description: "", CreatedAt: "now", UpdatedAt: "now" }],
  ]);
  const metadata = new Map([
    ["a.jpg", { Customization: { Tags: ["美食"] } }],
    ["b.jpg", { Customization: { Tags: ["美食"] } }],
  ]);
  const catalog = createSimpleRegistryCatalog({
    definitionKey: "Text",
    dataFileName: "tag_registry.jsonl",
    defaultDescription: "",
    backupReason: "test",
    normalize: (value) => String(value || "").trim(),
    extractReferences: (item) => item.Customization.Tags,
    getRegistry: () => registry,
    getMetadata: () => metadata,
    resolveDataFile: () => "unused",
    prepareLibraryWrite: async () => {},
    touchLibraryManifest: async () => {},
    readJsonlStrict: async () => [],
    writeJsonlAtomic: async () => {},
  });
  assert.deepEqual(catalog.validateMany(["美食", "美食", "未知"]), {
    values: ["美食", "未知"],
    unknown: ["未知"],
  });
  assert.equal(catalog.listDefinitions()[0].UsageCount, 2);
});
