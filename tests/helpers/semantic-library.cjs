const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { DATA_FILE_NAMES, writeJsonlAtomic } = require('../../scripts/library-core');

// Populate an isolated, initialized test library with every registry reference.
async function assignSemanticRegistries(paths) {
  const [tag, album, person, parent, child] = Array.from({ length: 5 }, () => randomUUID());
  const common = { Description: 'Fixture description', CreatedAt: '2026-01-01T00:00:00Z', UpdatedAt: '2026-01-01T00:00:00Z' };
  const locations = { ...common, Country: 'US', Province: 'California', City: 'Santa Cruz' };
  const rows = {
    tags: [{ ...common, TagId: tag, Text: '海景' }],
    albums: [{ ...common, AlbumId: album, Title: 'Coastal trip' }],
    people: [{ ...common, PersonId: person, Name: 'Alex' }],
    locations: [
      { ...locations, LocationId: parent, Name: 'Coast', ParentId: null },
      { ...locations, LocationId: child, Name: 'Beach', ParentId: parent },
    ],
  };
  for (const [kind, entries] of Object.entries(rows)) {
    await writeJsonlAtomic(path.join(paths.dataDir, DATA_FILE_NAMES[kind]), entries);
  }
  const items = (await fs.readFile(paths.metadataFile, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  for (const item of items) {
    Object.assign(item.Customization, { Title: 'Sea scenery', Description: 'Waves at the beach', TagIds: [tag], AlbumId: album, PersonIds: [person] });
    item.Location = { LocationId: child, Detail: 'Near the pier' };
  }
  await writeJsonlAtomic(paths.metadataFile, items);
  return { tag, album, person, parent, child };
}

module.exports = { assignSemanticRegistries };
