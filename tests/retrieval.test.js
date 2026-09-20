const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  project,
  sampleCount,
  selectFrames,
  profiles,
  resultLimit,
  validateQuery,
} = require("../src/main/semantic/domain");
const store = require("../src/main/semantic/index-store");
const { buildIndex } = require("../src/main/semantic/index-builder");
const { rank } = require("../src/main/semantic/vector-search-worker");
const { createRetrievalService } = require("../src/main/retrieval/service");
const registry = () => ({
  tags: new Map(),
  albums: new Map(),
  people: new Map(),
  locations: new Map(),
});
const item = () => ({
  MediaId: randomUUID(),
  SHA256Hash: "a".repeat(64),
  FilePath: "private.jpg",
  FileSystem: { FileType: "image" },
  Customization: {
    Title: "Ocean",
    Description: "Sea scenery",
    HiddenDescription: "secret",
    Rating: 5,
    Privacy: 1,
    TagIds: [],
    PersonIds: [],
    AlbumId: null,
  },
  Location: { LocationId: null, Detail: "" },
});
const vector = (d, axis = 0) =>
  Array.from({ length: d }, (_, i) => (i === axis ? 1 : 0));
const defaults = () => ({
  filters: { privacyLevels: [1], ratingLevels: [] },
  search: { value: "" },
});
const planned = {
  visualQuery: "sea",
  descriptiveQuery: "sea",
  contextualQuery: "",
};
const completion = (calls = [], text = "") => ({
  text,
  calls: calls.map((argumentsValue) => ({
    providerId: randomUUID(),
    name: "semantic_search",
    arguments: JSON.stringify(argumentsValue),
  })),
  finish: calls.length ? "calls" : "stop",
  usage: { inputCacheHit: 0, inputCacheMiss: 10, inputTotal: 10, output: 5 },
  continuation: null,
});
async function finish(s) {
  for (let i = 0; i < 300; i++) {
    if (!s.snapshot().working) return s.snapshot();
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error("Request did not finish");
}
function service({
  complete = async () => completion([planned]),
  items = Array.from({ length: 15 }, item),
  search = {
    encode: async () => ({ visual: [vector(512)] }),
    rank: async ({ ids }) => ids,
    dispose() {},
  },
} = {}) {
  const lib = {
    sessionId: randomUUID(),
    manifest: { libraryId: randomUUID() },
    paths: {},
  };
  const events = [];
  const s = createRetrievalService({
    getLibrary: () => lib,
    getItems: () => items,
    executeQuery: (items, q) => ({
      items: q.search.value
        ? items.filter((i) => i.Customization.Title.includes(q.search.value))
        : items,
    }),
    readConfig: async () => ({}),
    complete,
    search,
    emit: (s) => events.push(s),
  });
  return { s, items, lib, events };
}
test("metadata projection excludes hidden descriptions, paths, rating and privacy", () => {
  const i = item(),
    r = registry(),
    before = project(i, r);
  for (const key of ["HiddenDescription", "Rating", "Privacy"])
    i.Customization[key] = "changed";
  i.FilePath = "elsewhere.jpg";
  assert.deepEqual(project(i, r), before);
  i.Customization.Description = "Mountain";
  const after = project(i, r);
  assert.notEqual(
    after.fingerprints.description,
    before.fingerprints.description,
  );
  assert.equal(after.fingerprints.context, before.fingerprints.context);
  assert.equal(after.fingerprints.visual, before.fingerprints.visual);
  const tag = randomUUID();
  i.Customization.TagIds = [tag];
  r.tags.set(tag, { TagId: tag, Text: "食物", Description: "food" });
  const first = project(i, r);
  r.tags.get(tag).Description = "meal";
  assert.notEqual(
    project(i, r).fingerprints.description,
    first.fingerprints.description,
  );
});
test("piecewise video sampling covers boundaries and distinct frames", () => {
  for (const [d, n] of [
    [0.01, 10],
    [9.99, 10],
    [10, 10],
    [10.1, 11],
    [30, 18],
    [59.99, 30],
    [60, 30],
    [60.1, 31],
    [120, 40],
    [599.99, 120],
    [600, 120],
    [600.1, 120],
  ])
    assert.equal(sampleCount(d), n);
  for (const count of [1, 5, 10, 11, 100]) {
    const times = Array.from({ length: count }, (_, i) => (i * i) / 100);
    const selected = selectFrames(times, 10);
    assert.equal(selected.length, Math.min(count, 10));
    assert.equal(new Set(selected).size, selected.length);
    assert.equal(selected[0], 0);
    assert.equal(selected.at(-1), count - 1);
  }
  assert.deepEqual(
    selectFrames(
      Array.from({ length: 100 }, (_, i) => i),
      10,
    ),
    [0, 11, 22, 33, 44, 55, 66, 77, 88, 99],
  );
  assert.throws(() => sampleCount(0));
});
test("result count and query schema are strictly application controlled", () => {
  for (const n of [1, 10, 100]) assert.equal(resultLimit(n), n);
  for (const n of [0, 101, 1.5, "10", NaN]) assert.throws(() => resultLimit(n));
  assert.deepEqual(validateQuery(planned), planned);
  assert.throws(() => validateQuery({ ...planned, count: 50 }));
  assert.throws(() =>
    validateQuery({
      visualQuery: "",
      descriptiveQuery: "",
      contextualQuery: "",
    }),
  );
});
test("semantic application returns top N, reranks filters/count without provider calls and resets per library", async () => {
  let calls = 0,
    encodes = 0;
  const { s, items } = service({
    complete: async () => {
      calls++;
      return completion([planned]);
    },
    search: {
      encode: async () => {
        encodes++;
        return {};
      },
      rank: async ({ ids }) => ids,
      dispose() {},
    },
  });
  await s.queryItems(defaults());
  s.send("Please return 99 sea pictures");
  await finish(s);
  assert.equal(s.snapshot().count, 10);
  assert.equal((await s.queryItems(defaults())).length, 10);
  s.setLimit(100);
  assert.equal((await s.queryItems(defaults())).length, 15);
  items[0].Customization.Title = "Only";
  const q = defaults();
  q.search.value = "Only";
  assert.equal((await s.queryItems(q)).length, 1);
  assert.equal(calls, 1);
  assert.equal(encodes, 1);
  s.control("new");
  assert.ok(s.snapshot().semanticQuery);
  assert.equal(s.snapshot().messages.length, 0);
  assert.equal(s.snapshot().limit, 100);
  s.control("clear");
  assert.equal(s.snapshot().semanticQuery, null);
  await s.close();
  assert.equal(s.snapshot().limit, 10);
});
test("clarification follow-up uses prior context and requires no reference authorization", async () => {
  let calls = 0;
  const { s } = service({
    complete: async (history) => {
      calls++;
      if (calls === 1) return completion([], "Which beach?");
      assert.ok(history.some((m) => m.content === "Which beach?"));
      return completion([planned]);
    },
  });
  await s.queryItems(defaults());
  s.send("Beach");
  await finish(s);
  assert.equal(s.snapshot().semanticQuery, null);
  s.send("Santa Cruz");
  await finish(s);
  assert.ok(s.snapshot().semanticQuery);
});
test("invalid planning allows one correction, and no old result can apply after clear", async () => {
  let calls = 0;
  const { s } = service({
    complete: async () => {
      calls++;
      return completion([{ ...planned, count: 99 }]);
    },
  });
  await s.queryItems(defaults());
  s.send("Sea");
  const failed = await finish(s);
  assert.equal(calls, 2);
  assert.equal(failed.messages.at(-1).status, "failed");
  assert.equal(failed.semanticQuery, null);
  let release;
  const delayed = service({
    complete: async () => {
      await new Promise((r) => (release = r));
      return completion([planned]);
    },
  }).s;
  await delayed.queryItems(defaults());
  delayed.send("Sea");
  while (!release) await new Promise((r) => setImmediate(r));
  delayed.control("clear");
  release();
  await finish(delayed);
  assert.equal(delayed.snapshot().semanticQuery, null);
});
test("manual index snapshots remain searchable after edits, support partial vectors and exclude deleted media", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "semantic-index-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const paths = { managerDir: root, semanticDir: path.join(root, "semantic") },
    id = randomUUID(),
    i = item(),
    r = registry();
  const fake = {
    encode: async (_kind, texts) =>
      texts.map(() => [{ vector: vector(384), start: 0, end: 3 }]),
  };
  await buildIndex({
    paths,
    libraryId: id,
    items: [i],
    registries: r,
    embeddings: fake,
  });
  let index = await store.readIndex(paths, id);
  assert.equal(index.entries.length, 1);
  assert.equal((await store.status(paths, id, [i], r)).partial, 1);
  i.Customization.Description = "Changed after building";
  assert.equal((await store.status(paths, id, [i], r)).outdated, 1);
  const found = await rank({
    paths,
    libraryId: id,
    queries: { description: [vector(384)] },
    ids: [i.MediaId],
  });
  assert.deepEqual(found, [i.MediaId]);
  assert.deepEqual(
    await rank({
      paths,
      libraryId: id,
      queries: { description: [vector(384)] },
      ids: [],
    }),
    [],
  );
  let generated = 0;
  fake.encode = async (_k, texts) => {
    generated += texts.length;
    return texts.map(() => [{ vector: vector(384), start: 0, end: 3 }]);
  };
  await buildIndex({
    paths,
    libraryId: id,
    items: [i],
    registries: r,
    embeddings: fake,
  });
  assert.equal(generated, 1);
  assert.equal((await store.status(paths, id, [i], r)).outdated, 0);
  await buildIndex({
    paths,
    libraryId: id,
    items: [i],
    registries: r,
    embeddings: fake,
  });
  assert.equal(generated, 1);
  const before = await fs.readFile(
    path.join(paths.semanticDir, "current.json"),
    "utf8",
  );
  fake.encode = async () => {
    throw new Error("inference failed");
  };
  await buildIndex({
    paths,
    libraryId: id,
    items: [i],
    registries: r,
    embeddings: fake,
    force: true,
  });
  assert.equal(
    await fs.readFile(path.join(paths.semanticDir, "current.json"), "utf8"),
    before,
  );
  index = await store.readIndex(paths, id);
  await fs.writeFile(
    path.join(paths.semanticDir, "objects", index.entries[0].blob + ".f32"),
    "bad",
  );
  await assert.rejects(() => store.status(paths, id, [i], r), /Corrupt/);
});
test("partial lane blobs validate strictly and publication is library-bound", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "semantic-partial-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const paths = { semanticDir: path.join(root, "semantic") },
    id = randomUUID(),
    i = item();
  const blob = await store.writeVectors(paths, "visual", [
      vector(512),
      vector(512, 1),
    ]),
    entry = {
      mediaId: i.MediaId,
      lane: "visual",
      profile: profiles.visual,
      inputHash: project(i, registry()).fingerprints.visual,
      blob,
      count: 2,
      expected: 10,
      parts: [0, 9],
    };
  await store.publish(paths, id, new Map([["x", entry]]));
  assert.equal((await store.readIndex(paths, id)).entries[0].count, 2);
  await assert.rejects(() => store.readIndex(paths, randomUUID()), /identity/);
  assert.deepEqual(
    await rank({
      paths,
      libraryId: id,
      queries: { visual: [vector(512)] },
      ids: [i.MediaId],
    }),
    [i.MediaId],
  );
});
test("Stop and independent windows preserve last results without cross-window state", async () => {
  const one = service(),
    two = service();
  await one.s.queryItems(defaults());
  await two.s.queryItems(defaults());
  one.s.setLimit(3);
  assert.equal(two.s.snapshot().limit, 10);
  one.s.send("Sea");
  await finish(one.s);
  await one.s.stop();
  assert.ok(one.s.snapshot().semanticQuery);
  assert.equal(two.s.snapshot().semanticQuery, null);
  await one.s.close();
  await two.s.close();
});
