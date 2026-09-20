const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const { resolveLibraryPaths, readLibraryManifest, writeJsonlAtomic } = require('../scripts/library-core');
const { DEFAULT_CONFIG } = require('../scripts/application-config');
const { loadIndexInputs } = require('../scripts/build-semantic-index');
const { assignSemanticRegistries } = require('./helpers/semantic-library.cjs');
const { project } = require('../src/main/semantic/domain');
const { buildIndex } = require('../src/main/semantic/index-builder');
const { readIndex } = require('../src/main/semantic/index-store');

test('maintenance loads all registry ID maps from disk and builds all lanes without changing metadata', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-inputs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const paths = resolveLibraryPaths(root);
  await sharp({ create: { width: 20, height: 10, channels: 3, background: '#336699' } }).jpeg().toFile(path.join(root, 'fixture.jpg'));
  await require('../scripts/init-metadata').run({ paths, config: structuredClone(DEFAULT_CONFIG), logger: { info() {}, warn() {}, error() {} } });
  const ids = await assignSemanticRegistries(paths);
  const before = await fs.readFile(paths.metadataFile);
  const inputs = await loadIndexInputs(paths);
  for (const map of Object.values(inputs.registries)) assert.ok(map instanceof Map);
  assert.equal(inputs.registries.locations.get(ids.child).ParentId, ids.parent);
  const document = project(inputs.items[0], inputs.registries);
  assert.match(document.description, /海景/);
  for (const value of ['Coastal trip', 'Alex', 'Coast / Beach', 'Santa Cruz', 'Near the pier']) assert.ok(document.context.includes(value));
  const result = await buildIndex({ paths, libraryId: (await readLibraryManifest(paths)).libraryId, ...inputs,
    embeddings: { encode: async (kind, values) => values.map(() => {
      const vector = Array.from({ length: kind === 'image' ? 512 : 384 }, (_, i) => i === 0 ? 1 : 0);
      return kind === 'image' ? vector : [{ vector, start: 0, end: 1 }];
    }) },
  });
  assert.equal(result.generated, 3); assert.equal(result.failed, 0);
  assert.equal((await readIndex(paths, (await readLibraryManifest(paths)).libraryId)).entries.length, 3);
  assert.deepEqual(await fs.readFile(paths.metadataFile), before);
  inputs.items[0].Customization.TagIds = ['00000000-0000-4000-8000-000000000000'];
  await writeJsonlAtomic(paths.metadataFile, inputs.items);
  await assert.rejects(loadIndexInputs(paths), /Unknown TagId/);
});
