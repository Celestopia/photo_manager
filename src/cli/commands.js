const { one, integer, usage } = require('./arguments');
const { REGISTRIES, registryId, readJson, galleryQuery } = require('./selectors');
const { assertUuidV4 } = require('../shared/identity-schema');
const { assertExactObjectKeys } = require('../shared/object-schema');
const { writeLibraryManifest, normalizeLibraryName } = require('../core/library-core');

function unwrap(result) {
  if (result?.ok === false) throw Object.assign(new Error(result.error), { code: result.code || 'OPERATION_FAILED' });
  return result;
}
function field(item, key) {
  const parts = key.split('.');
  let value = item;
  for (const part of parts) {
    if (!value || !Object.hasOwn(value, part)) throw usage(`Unknown media field: ${key}`);
    value = value[part];
  }
  return value;
}
async function mediaCommand(action, values, session, context) {
  const { state, backend } = session;
  if (action === 'show') {
    const id = one(values.id, 'id', true); assertUuidV4(id, 'MediaId');
    const item = state.metadataIndex.get(id);
    if (!item) throw Object.assign(new Error(`MediaId not found: ${id}`), { code: 'NOT_FOUND' });
    return item;
  }
  if (action === 'list') {
    const query = await galleryQuery(values, state);
    const { items } = backend.executeGalleryQuery(state.metadataIndex.values(), query);
    const offset = values.offset === undefined ? 0 : integer(values.offset, 'offset');
    const limit = values.limit === undefined ? items.length : integer(values.limit, 'limit');
    const keys = values.fields?.split(',');
    if (keys?.some(key => !key || key.split('.').some(part => ['__proto__', 'prototype', 'constructor'].includes(part)))) throw usage('Invalid --fields');
    // Validate even when the requested page is empty.
    if (keys && state.metadataIndex.size) for (const key of keys) {
      if (![...state.metadataIndex.values()].some(item => { try { field(item, key); return true; } catch { return false; } })) throw usage(`Unknown media field: ${key}`);
    }
    const page = items.slice(offset, offset + limit).map(item => {
      if (keys) return Object.fromEntries(keys.map(key => { try { return [key, field(item, key)]; } catch { return [key, null]; } }));
      if ((values.format || 'text') !== 'text') return item;
      return { MediaId: item.MediaId, FilePath: item.FilePath, Title: item.Customization.Title,
        Type: item.FileSystem.FileType, Rating: item.Customization.Rating, Privacy: item.Customization.Privacy };
    });
    return { total: items.length, returned: page.length, items: page };
  }
  if (values.id && values['ids-file']) throw usage('Use --id or --ids-file, not both');
  const ids = values['ids-file'] ? await readJson(values['ids-file']) : values.id || [];
  const patch = values['patch-file'] ? await readJson(values['patch-file']) : {};
  assertExactObjectKeys(patch, ['customization', 'location', 'addTagIds', 'removeTagIds', 'addPersonIds', 'removePersonIds'], 'Patch file');
  const payload = { ...patch, mediaIds: ids };
  if (patch.customization !== undefined && (!patch.customization || typeof patch.customization !== 'object' || Array.isArray(patch.customization))) throw usage('customization must be an object');
  if (patch.location !== undefined && (!patch.location || typeof patch.location !== 'object' || Array.isArray(patch.location))) throw usage('location must be an object');
  payload.customization = { ...(patch.customization || {}) };
  payload.location = { ...(patch.location || {}) };
  const set = (object, key, value) => {
    if (Object.hasOwn(object, key)) throw usage(`Field supplied more than once: ${key}`);
    object[key] = value;
  };
  for (const [flag, key] of [['title', 'Title'], ['description', 'Description'], ['hidden-description', 'HiddenDescription']]) {
    if (values[flag] !== undefined) set(payload.customization, key, values[flag]);
  }
  for (const flag of ['rating', 'privacy']) if (values[flag]) set(payload.customization, flag === 'rating' ? 'Rating' : 'Privacy', integer(one(values[flag], flag), flag, 1, 5));
  for (const [flag, key] of [['album', 'AlbumId'], ['location', 'LocationId']]) {
    const target = flag === 'album' ? payload.customization : payload.location;
    if (values[flag]) set(target, key, registryId(state, flag, one(values[flag], flag)));
    if (values['clear-' + flag]) set(target, key, null);
  }
  if (values.detail !== undefined) set(payload.location, 'Detail', values.detail);
  if (values['clear-location']) {
    if (Object.hasOwn(payload.location, 'Detail')) throw usage('--clear-location cannot be combined with detail');
    payload.location.Detail = '';
  }
  for (const [kind, fieldName, clearFlag] of [['tag', 'TagIds', 'clear-tags'], ['person', 'PersonIds', 'clear-people']]) {
    if (values[kind]) set(payload.customization, fieldName, values[kind].map(id => registryId(state, kind, id)));
    if (values[clearFlag]) set(payload.customization, fieldName, []);
    for (const op of ['add', 'remove']) if (values[op + '-' + kind]) set(payload, op + fieldName, values[op + '-' + kind].map(id => registryId(state, kind, id)));
  }
  const service = backend.services.metadataEditService;
  const preview = await service.editMany(payload, { dryRun: true, signal: context.signal });
  if (values['dry-run']) return preview;
  if (preview.updatedCount > 1) await context.confirm(`Edit ${preview.updatedCount} media items?`, values.yes);
  context.signal.throwIfAborted();
  return service.editMany(payload, { signal: context.signal });
}

async function registryCommand(kind, action, values, session, context) {
  const spec = REGISTRIES[kind], { state, backend } = session;
  const service = backend.services[spec.service];
  const registry = state[spec.index];
  const idKey = spec.id[0].toLowerCase() + spec.id.slice(1);
  if (action === 'list') {
    const result = unwrap(await service.list());
    const items = Object.values(result).find(Array.isArray);
    return { total: items.length, items };
  }
  let id, current;
  if (action !== 'create') {
    id = registryId(state, kind, one(values.id, 'id', true)); current = registry.get(id);
  }
  if (action === 'show') return current;
  if (action === 'delete') {
    const preview = unwrap(await service.deleteGlobal({ [idKey]: id }, { dryRun: true }));
    if (values['dry-run']) return preview;
    await context.confirm(`Delete ${kind} ${JSON.stringify(current[spec.label])} globally? Affected media: ${preview.updatedCount}${kind === 'location' ? `; detached children: ${preview.orphanedChildren}` : ''}.`, values.yes);
    context.signal.throwIfAborted();
    return unwrap(await service.deleteGlobal({ [idKey]: id }));
  }
  if (action === 'create' && values.name === undefined) throw usage('--name is required');
  const payload = { ...(id ? { [idKey]: id } : {}), [spec.payload]: values.name ?? current?.[spec.label],
    description: values.description ?? current?.Description ?? '' };
  if (kind === 'location') {
    for (const key of ['country', 'province', 'city']) payload[key] = values[key] ?? current?.[key[0].toUpperCase() + key.slice(1)] ?? '';
    if (values.parent && values['clear-parent']) throw usage('Cannot combine --parent with --clear-parent');
    payload.parentId = values['clear-parent'] ? null : values.parent !== undefined ? registryId(state, 'location', values.parent) : current?.ParentId ?? null;
  }
  if (action === 'update' && !['name', 'description', 'country', 'province', 'city', 'parent', 'clear-parent'].some(key => Object.hasOwn(values, key))) throw usage('No registry fields supplied');
  context.signal.throwIfAborted();
  return unwrap(await service[action](payload));
}

async function sessionCommand(command, values, session, context) {
  const [group, action, registryAction] = command.split(' ');
  if (group === 'media') return mediaCommand(action, values, session, context);
  if (group === 'registry') return registryCommand(action, registryAction, values, session, context);
  const library = session.state.activeLibrary;
  if (action === 'info') return { ...library.manifest, root: library.paths.root,
    mediaCount: session.state.metadataIndex.size,
    registryCounts: Object.fromEntries(Object.entries(REGISTRIES).map(([kind, spec]) => [kind, session.state[spec.index].size])) };
  if (action === 'rename') {
    if (values.name === undefined) throw usage('--name is required');
    const name = normalizeLibraryName(values.name);
    context.signal.throwIfAborted();
    await session.prepareLibraryWrite('library-rename', { immediate: true });
    library.manifest = await writeLibraryManifest(library.paths, { ...library.manifest, name, updatedAt: new Date().toISOString() });
    return library.manifest;
  }
  throw usage(`Unsupported command: ${command}`);
}
module.exports = { sessionCommand };
