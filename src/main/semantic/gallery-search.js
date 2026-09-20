const { resultLimit } = require('./domain');
const fields = new Set(['title', 'filename', 'description', 'semantic']);

function validateSearch(value) {
  if (!value || !fields.has(value.field) || typeof value.value !== 'string' || value.value.length > 2000)
    throw new Error('Invalid gallery search');
  const text = value.field === 'semantic' ? value.value.normalize('NFC').trim() : value.value;
  return { field: value.field, value: text.trim() ? text : '' };
}

function createGallerySearch({ search, getLibrary, getItems, executeQuery }) {
  let epoch = 0, controller = null, cached = null;
  function stop() {
    epoch++;
    controller?.abort();
    controller = null;
  }
  async function close() {
    stop();
    cached = null;
    await search.dispose();
  }
  async function query(options) {
    const applied = validateSearch(options?.search);
    const limit = resultLimit(options?.resultLimit ?? 10);
    stop();
    const revision = epoch;
    const current = new AbortController();
    controller = current;
    const lib = getLibrary();
    const assertCurrent = () => {
      current.signal.throwIfAborted();
      if (epoch !== revision || getLibrary() !== lib) throw new Error('Search cancelled');
    };
    try {
      const semantic = applied.field === 'semantic' && Boolean(applied.value);
      if (!semantic) return { items: executeQuery(getItems(), { ...options, search: applied }).items, semantic: false };
      let vectors;
      if (cached?.library === lib && cached.text === applied.value) vectors = cached.vectors;
      else {
        vectors = await search.encode(applied.value, current.signal);
        assertCurrent();
        cached = { library: lib, text: applied.value, vectors };
      }
      const items = executeQuery(getItems(), { ...options, search: { field: 'title', value: '' } }).items;
      const byId = new Map(items.map(item => [item.MediaId, item]));
      const ids = await search.rank({ paths: lib.paths, libraryId: lib.manifest.libraryId,
        queries: vectors, ids: [...byId.keys()] }, current.signal);
      assertCurrent();
      // Metadata can change while a worker scans; recheck current privacy and membership.
      const latest = new Map(executeQuery(getItems(), { ...options, search: { field: 'title', value: '' } }).items.map(item => [item.MediaId, item]));
      return { items: [...new Set(ids)].filter(id => byId.has(id) && latest.has(id)).slice(0, limit).map(id => latest.get(id)), semantic: true };
    } finally {
      if (controller === current) controller = null;
    }
  }
  return { query, stop, close };
}
module.exports = { createGallerySearch, validateSearch };
