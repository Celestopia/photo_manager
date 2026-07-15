const path = require("node:path");
const { DATA_FILE_NAMES, readJsonlStrict } = require("./library-core.js");
const {
  validateLocationRegistryEntries,
  validateMediaEntries,
  validateSimpleRegistryEntries,
} = require("../src/shared/library-data-schema.js");

async function loadRegistryIndexes(paths) {
  const tagEntries = await readJsonlStrict(path.join(paths.dataDir, DATA_FILE_NAMES.tags), {
    label: DATA_FILE_NAMES.tags,
    keyOf: (item) => item?.TagId,
  });
  const albumEntries = await readJsonlStrict(path.join(paths.dataDir, DATA_FILE_NAMES.albums), {
    label: DATA_FILE_NAMES.albums,
    keyOf: (item) => item?.AlbumId,
  });
  const personEntries = await readJsonlStrict(path.join(paths.dataDir, DATA_FILE_NAMES.people), {
    label: DATA_FILE_NAMES.people,
    keyOf: (item) => item?.PersonId,
  });
  const locationEntries = await readJsonlStrict(path.join(paths.dataDir, DATA_FILE_NAMES.locations), {
    label: DATA_FILE_NAMES.locations,
    keyOf: (item) => item?.LocationId,
  });

  return {
    tags: validateSimpleRegistryEntries(tagEntries, { idKey: "TagId", labelKey: "Text", kind: "tag" }),
    albums: validateSimpleRegistryEntries(albumEntries, { idKey: "AlbumId", labelKey: "Title", kind: "album" }),
    people: validateSimpleRegistryEntries(personEntries, { idKey: "PersonId", labelKey: "Name", kind: "person" }),
    locations: validateLocationRegistryEntries(locationEntries),
  };
}

function validateMetadataMap(metadataByPath, registries) {
  return validateMediaEntries([...metadataByPath.values()], registries);
}

module.exports = { loadRegistryIndexes, validateMetadataMap };
