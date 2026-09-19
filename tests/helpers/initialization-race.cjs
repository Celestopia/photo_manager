// Barrier-controlled real competing processes; no external media tools needed.
const { DEFAULT_CONFIG } = require('../../scripts/application-config');
const { resolveLibraryPaths } = require('../../scripts/library-core');
const mediaTools = require('../../scripts/media-tools');
mediaTools.validateMediaTools = async () => {
  await new Promise(resolve => {
    process.once('message', resolve);
    process.send({ ready: true });
  });
};
const { run } = require('../../scripts/init-metadata');
run({ paths: resolveLibraryPaths(process.argv[2]), config: DEFAULT_CONFIG }).then(
  () => process.send({ ok: true }, () => process.disconnect()),
  error => process.send({ ok: false, error: error.message }, () => process.disconnect()),
);
