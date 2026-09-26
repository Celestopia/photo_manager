// Barrier-controlled real competing processes; no external media tools needed.
const { DEFAULT_CONFIG } = require('../../src/core/application-config');
const { resolveLibraryPaths } = require('../../src/core/library-core');
const mediaTools = require('../../src/core/media-tools');
mediaTools.validateMediaTools = async () => {
  await new Promise(resolve => {
    process.once('message', resolve);
    process.send({ ready: true });
  });
};
const { run } = require('../../src/core/init-metadata');
run({ paths: resolveLibraryPaths(process.argv[2]), config: DEFAULT_CONFIG }).then(
  () => process.send({ ok: true }, () => process.disconnect()),
  error => process.send({ ok: false, error: error.message }, () => process.disconnect()),
);
