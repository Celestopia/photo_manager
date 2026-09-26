const fs = require('node:fs/promises');
const { usage, integer } = require('./arguments');
const { assertUuidV4 } = require('../shared/identity-schema');
const REGISTRIES = {
  tag: { index: 'tagRegistryIndex', id: 'TagId', label: 'Text', payload: 'text', service: 'tagService' },
  album: { index: 'albumRegistryIndex', id: 'AlbumId', label: 'Title', payload: 'title', service: 'albumService' },
  person: { index: 'personRegistryIndex', id: 'PersonId', label: 'Name', payload: 'name', service: 'personService' },
  location: { index: 'locationRegistryIndex', id: 'LocationId', label: 'Name', payload: 'name', service: 'locationService' },
};
async function readJson(file) {
  try { return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { throw usage(`Cannot read JSON file ${file}: ${error.message}`); }
}
function registryId(state, kind, id, allowUnassigned = false) {
  if (allowUnassigned && id === 'unassigned') return '__UNASSIGNED__';
  assertUuidV4(id, kind + ' ID');
  if (!state[REGISTRIES[kind].index].has(id)) throw Object.assign(new Error(`${kind} ID not found: ${id}`), { code: 'NOT_FOUND' });
  return id;
}
function registryName(state, kind, name) {
  const spec = REGISTRIES[kind];
  const matches = [...state[spec.index].values()].filter(item => item[spec.label] === name);
  if (matches.length === 1) return matches[0][spec.id];
  const error = new Error(matches.length ? `Ambiguous ${kind} name: ${name}; use its ID` : `${kind} name not found: ${name}`);
  error.code = matches.length ? 'AMBIGUOUS_NAME' : 'NOT_FOUND';
  error.candidates = matches;
  throw error;
}
async function galleryQuery(values, state) {
  const filters = { mediaType: values.type || '', ratingLevels: [], privacyLevels: [], locationRegion: [] };
  if (!['', 'image', 'video'].includes(filters.mediaType)) throw usage('--type must be image or video');
  for (const kind of Object.keys(REGISTRIES)) filters[kind] = [...new Set([
    ...(values[kind] || []).map(id => registryId(state, kind, id, true)),
    ...(values[kind + '-name'] || []).map(name => registryName(state, kind, name)),
  ])];
  for (const key of ['rating', 'privacy']) filters[key + 'Levels'] = (values[key] || []).map(value => integer(value, key, 1, 5));
  if (values['regions-file']) {
    filters.locationRegion = await readJson(values['regions-file']);
    if (!Array.isArray(filters.locationRegion)) throw usage('--regions-file must contain an array');
    for (const region of filters.locationRegion) {
      if (!region || typeof region !== 'object' || Array.isArray(region)
        || Object.keys(region).some(key => !['level', 'country', 'province', 'city'].includes(key) || typeof region[key] !== 'string')
        || !['country', 'province', 'city'].includes(region.level)) throw usage('Invalid region object');
    }
  }
  if (['country', 'province', 'city'].some(key => values[key] !== undefined)) {
    filters.locationRegion.push({ level: values.city ? 'city' : values.province ? 'province' : 'country',
      country: values.country || '', province: values.province || '', city: values.city || '' });
  }
  const field = values['search-field'] || 'title';
  if (!['title', 'filename', 'description'].includes(field)) throw usage('--search-field must be title, filename, or description');
  if (values['search-field'] && values.search === undefined) throw usage('--search-field requires --search');
  const order = values.order || 'desc';
  if (!['asc', 'desc'].includes(order)) throw usage('--order must be asc or desc');
  return { filters, search: { field, value: values.search || '' }, sortBy: 'shootingTime', sortOrder: order };
}
module.exports = { REGISTRIES, registryId, readJson, galleryQuery };
