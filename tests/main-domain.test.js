const test = require("node:test");
const assert = require("node:assert/strict");

const { applyConfigPatch } = require("../src/main/application-config.js");
const { createApplicationRuntime } = require("../src/main/application-runtime.js");
const { createGalleryQueryService } = require("../src/main/gallery-query.js");
const {
  createLocationDomain,
  normalizeLocationField,
  normalizeLocationName,
} = require("../src/main/location-domain.js");
const { createLocationRegistryService } = require("../src/main/location-registry-service.js");
const { createSimpleRegistryCatalog } = require("../src/main/simple-registry-catalog.js");
const { createSimpleRegistryService } = require("../src/main/simple-registry-service.js");
const { locationContextKey } = require("../src/shared/library-data-schema.js");

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
    [IDS.campus, { LocationId: IDS.campus, Name: "清华大学", Country: "中国", Province: "", City: "北京", ParentId: null }],
    [IDS.dining, { LocationId: IDS.dining, Name: "清芬园食堂", Country: "中国", Province: "", City: "北京", ParentId: IDS.campus }],
    [IDS.floor, { LocationId: IDS.floor, Name: "二层", Country: "中国", Province: "江苏", City: "南京", ParentId: IDS.dining }],
  ]);
  const domain = createLocationDomain(() => registry);
  assert.deepEqual(domain.buildLocationPath(IDS.floor), ["清华大学", "清芬园食堂", "二层"]);
  assert.deepEqual(new Set(domain.getLocationDescendants(IDS.campus)), new Set([IDS.dining, IDS.floor]));
  assert.deepEqual(new Set(domain.getLocationIdsForRegion({ level: "city", country: "中国", province: "", city: "北京" })), new Set([IDS.campus, IDS.dining]));
  assert.deepEqual(domain.getLocationIdsForRegion({ level: "province", country: "中国", province: "江苏", city: "" }), [IDS.floor]);
  assert.throws(
    () => domain.getLocationIdsForRegion({ level: "city", country: "中国", province: "", city: "不存在" }),
    /does not match/,
  );
  assert.deepEqual(domain.validateLocationParent(IDS.campus, IDS.floor), {
    ok: false,
    error: "Parent cannot be a descendant location",
  });
});

test("gallery query composes descendant location ID filters with shooting-time sorting", () => {
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
    search: { field: "", value: "" }, sortBy: "shootingTime", sortOrder: "asc",
  });
  assert.deepEqual(result.map((item) => item.FilePath), ["b.jpg"]);
});

test("gallery query composes administrative region and registry filters", () => {
  const service = createGalleryQueryService({
    getLocationDescendants: () => [],
    getLocationIdsForRegion: (region) => region.city === "北京" ? [IDS.campus, IDS.dining] : [],
    unassignedAlbumFilter: "__UNASSIGNED__",
  });
  const items = [
    { FilePath: "campus.jpg", Location: { LocationId: IDS.campus }, Customization: { AlbumId: IDS.tag, TagIds: [] } },
    { FilePath: "dining.jpg", Location: { LocationId: IDS.dining }, Customization: { AlbumId: IDS.other, TagIds: [] } },
    { FilePath: "nanjing.jpg", Location: { LocationId: IDS.floor }, Customization: { AlbumId: IDS.tag, TagIds: [] } },
  ];
  const result = service.filterAndSort(items, {
    filters: {
      mediaType: "", album: IDS.tag, tag: "", person: "", location: "",
      locationRegion: { level: "city", country: "中国", province: "", city: "北京" },
    },
    search: { field: "", value: "" }, sortBy: "shootingTime", sortOrder: "asc",
  });
  assert.deepEqual(result.map((item) => item.FilePath), ["campus.jpg"]);
  assert.throws(() => service.filterAndSort(items, {
    filters: {
      mediaType: "", album: "", tag: "", person: "", location: IDS.campus,
      locationRegion: { level: "country", country: "中国", province: "", city: "" },
    },
    search: { field: "", value: "" }, sortBy: "shootingTime", sortOrder: "asc",
  }), /mutually exclusive/);
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

test("gallery query treats empty rating and privacy level selections as all", () => {
  const service = createGalleryQueryService({ getLocationDescendants: () => [], unassignedAlbumFilter: "__UNASSIGNED__" });
  const items = [1, 2, 3, 4, 5].map((privacy) => ({
    FilePath: `privacy-${privacy}.jpg`, FileSystem: { ShootingTimeString: "2026-01-01" }, Customization: { Rating: 2, Privacy: privacy },
  }));
  const result = service.filterAndSort(items, {
    filters: { mediaType: "", album: "", tag: "", person: "", location: "", ratingLevels: [], privacyLevels: [] },
    search: { field: "", value: "" }, sortBy: "shootingTime", sortOrder: "asc",
  });
  assert.equal(result.length, 5);
});

test("gallery query combines rating and privacy multi-select filters", () => {
  const service = createGalleryQueryService({ getLocationDescendants: () => [], unassignedAlbumFilter: "__UNASSIGNED__" });
  const items = [
    { FilePath: "a.jpg", FileSystem: { ShootingTimeString: "2026-01-01" }, Customization: { Rating: 2, Privacy: 1 } },
    { FilePath: "b.jpg", FileSystem: { ShootingTimeString: "2026-01-02" }, Customization: { Rating: 4, Privacy: 2 } },
    { FilePath: "c.jpg", FileSystem: { ShootingTimeString: "2026-01-03" }, Customization: { Rating: 4, Privacy: 3 } },
    { FilePath: "d.jpg", FileSystem: { ShootingTimeString: "2026-01-04" }, Customization: { Rating: 5, Privacy: 1 } },
  ];
  const result = service.filterAndSort(items, {
    filters: {
      mediaType: "", album: "", tag: "", person: "", location: "",
      ratingLevels: [2, 4], privacyLevels: [1, 2],
    },
    search: { field: "", value: "" }, sortBy: "shootingTime", sortOrder: "desc",
  });
  assert.deepEqual(result.map((item) => item.FilePath), ["b.jpg", "a.jpg"]);
});

test("gallery query rejects removed sorting modes", () => {
  const service = createGalleryQueryService({ getLocationDescendants: () => [], unassignedAlbumFilter: "__UNASSIGNED__" });
  const options = {
    filters: { mediaType: "", album: "", tag: "", person: "", location: "" },
    search: { field: "", value: "" }, sortOrder: "asc",
  };
  assert.throws(() => service.filterAndSort([], { ...options, sortBy: "filename" }), /Unsupported gallery sort/);
  assert.throws(() => service.filterAndSort([], { ...options, sortBy: "rating" }), /Unsupported gallery sort/);
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

test("simple registry updates names atomically without rewriting media references", async () => {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const registry = new Map([
    [IDS.tag, { TagId: IDS.tag, Text: "美食", Description: "旧说明", CreatedAt: createdAt, UpdatedAt: createdAt }],
    [IDS.unknownTag, { TagId: IDS.unknownTag, Text: "校园", Description: "", CreatedAt: createdAt, UpdatedAt: createdAt }],
  ]);
  const metadata = new Map([[IDS.other, { Customization: { TagIds: [IDS.tag] } }]]);
  const metadataBefore = structuredClone([...metadata.entries()]);
  let failWrite = false;
  let saveCount = 0;
  const listDefinitions = () => [...registry.values()].map((definition) => ({
    ...definition,
    UsageCount: definition.TagId === IDS.tag ? 1 : 0,
  }));
  const service = createSimpleRegistryService({
    kind: "Tag", keyLabel: "Tag text", idKey: "TagId", definitionKey: "Text",
    responseItemKey: "tag", responseListKey: "tags", dataFileName: "tag_registry.jsonl",
    descriptionRequired: false, normalize: (value) => String(value ?? "").trim(),
    readKey: (payload) => payload?.text, readId: (payload) => payload?.tagId,
    readDescription: (payload) => payload?.description, getRegistry: () => registry,
    setRegistry: () => {}, getMetadata: () => metadata, setMetadata: () => {},
    requireOpenLibrary: () => {}, prepareLibraryWrite: async () => {},
    saveRegistry: async () => { saveCount += 1; if (failWrite) throw new Error("disk full"); },
    saveTransaction: async () => {}, listDefinitions,
    getUsageCounts: () => new Map([[IDS.tag, 1]]),
    sortEntries: (values) => [...values],
    findByLabel: (label) => [...registry.values()].find((definition) => definition.Text === label) || null,
    mutateMetadataOnDelete: () => false, appendLog: () => {},
  });

  const renamed = await service.update({ tagId: IDS.tag, text: "餐饮", description: "新说明" });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.tag.TagId, IDS.tag);
  assert.equal(renamed.tag.Text, "餐饮");
  assert.equal(renamed.tag.Description, "新说明");
  assert.equal(renamed.tag.CreatedAt, createdAt);
  assert.notEqual(renamed.tag.UpdatedAt, createdAt);
  assert.deepEqual([...metadata.entries()], metadataBefore);

  const duplicate = await service.update({ tagId: IDS.tag, text: "校园", description: "" });
  assert.equal(duplicate.ok, false);
  assert.equal(registry.get(IDS.tag).Text, "餐饮");

  failWrite = true;
  const failed = await service.update({ tagId: IDS.tag, text: "晚餐", description: "" });
  assert.equal(failed.ok, false);
  assert.equal(registry.get(IDS.tag).Text, "餐饮");
  assert.equal(registry.get(IDS.tag).Description, "新说明");
  assert.equal(saveCount, 2);
});

test("location updates names while preserving IDs and rebuilding descendant paths", async () => {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const registry = new Map([
    [IDS.campus, {
      LocationId: IDS.campus, Name: "清华大学", Country: "中国", Province: "", City: "北京",
      ParentId: null, Description: "", CreatedAt: createdAt, UpdatedAt: createdAt,
    }],
    [IDS.dining, {
      LocationId: IDS.dining, Name: "清芬园食堂", Country: "中国", Province: "", City: "北京",
      ParentId: IDS.campus, Description: "", CreatedAt: createdAt, UpdatedAt: createdAt,
    }],
    [IDS.other, {
      LocationId: IDS.other, Name: "东门", Country: "中国", Province: "", City: "北京",
      ParentId: null, Description: "", CreatedAt: createdAt, UpdatedAt: createdAt,
    }],
  ]);
  const metadata = new Map([[IDS.tag, { Location: { LocationId: IDS.campus, Detail: "" } }]]);
  const metadataBefore = structuredClone([...metadata.entries()]);
  const domain = createLocationDomain(() => registry);
  let failWrite = false;
  const listDefinitions = () => [...registry.values()].map((location) => ({
    ...location,
    UsageCount: location.LocationId === IDS.campus ? 1 : 0,
    ChildrenIds: domain.getLocationChildrenMap().get(location.LocationId) || [],
    Depth: domain.getLocationDepth(location.LocationId),
    Path: domain.buildLocationPath(location.LocationId),
  }));
  const service = createLocationRegistryService({
    dataFileName: "location_registry.jsonl", getRegistry: () => registry, setRegistry: () => {},
    getMetadata: () => metadata, setMetadata: () => {}, normalizeName: normalizeLocationName,
    normalizeField: normalizeLocationField, validateParent: domain.validateLocationParent,
    getDepth: domain.getLocationDepth, buildPath: domain.buildLocationPath, listDefinitions,
    findDuplicate: (candidate, excludeId) => [...registry.values()].find((location) => (
      location.LocationId !== excludeId && locationContextKey(location) === locationContextKey(candidate)
    )) || null,
    sortEntries: (values) => [...values], requireOpenLibrary: () => {},
    prepareLibraryWrite: async () => {},
    saveRegistry: async () => { if (failWrite) throw new Error("disk full"); },
    saveTransaction: async () => {},
    appendLog: () => {},
  });

  const result = await service.update({
    locationId: IDS.campus, name: "清华园", country: "中国", province: "", city: "北京",
    parentId: null, description: "校园",
  });
  assert.equal(result.ok, true);
  assert.equal(result.location.LocationId, IDS.campus);
  assert.equal(result.location.Name, "清华园");
  assert.equal(result.location.CreatedAt, createdAt);
  assert.deepEqual(result.locations.find((location) => location.LocationId === IDS.dining).Path, ["清华园", "清芬园食堂"]);
  assert.deepEqual([...metadata.entries()], metadataBefore);

  const duplicate = await service.update({
    locationId: IDS.campus, name: "东门", country: "中国", province: "", city: "北京",
    parentId: null, description: "",
  });
  assert.equal(duplicate.ok, false);
  assert.equal(registry.get(IDS.campus).Name, "清华园");

  failWrite = true;
  const failed = await service.update({
    locationId: IDS.campus, name: "主校区", country: "中国", province: "", city: "北京",
    parentId: null, description: "",
  });
  assert.equal(failed.ok, false);
  assert.equal(registry.get(IDS.campus).Name, "清华园");
  assert.equal(registry.get(IDS.campus).Description, "校园");
});
