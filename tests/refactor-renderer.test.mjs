import test from 'node:test';
import assert from 'node:assert/strict';
import { ref, reactive } from 'vue';
import { useLibrarySession } from '../src/renderer/composables/use-library-session.js';
import { useTagRegistry } from '../src/renderer/composables/use-tag-registry.js';
import { usePersonRegistry } from '../src/renderer/composables/use-person-registry.js';
import { useAlbumRegistry } from '../src/renderer/composables/use-album-registry.js';
import { useLocationRegistry } from '../src/renderer/composables/use-location-registry.js';
import { useMediaViewer } from '../src/renderer/composables/use-media-viewer.js';

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const noop = () => {};
const windowStub = { confirm: () => true, addEventListener: noop, removeEventListener: noop };
function browser(t) { const previous = globalThis.window; globalThis.window = windowStub; t.after(() => { globalThis.window = previous; }); }

for (const method of ['openLibraryPath', 'chooseLibrary', 'confirmInitializeLibrary', 'recheckMediaTools', 'startMaintenanceOperation']) {
  test(`${method} releases busy state on transport rejection`, async () => {
    const fail = async () => { throw new Error('Transport disconnected'); };
    const session = useLibrarySession({ api: { openLibrary: fail, chooseLibraryDirectory: fail, initializeLibrary: fail, recheckMediaTools: fail, startMaintenance: fail }, showToastMessage: noop });
    await session[method]('fixture');
    assert.equal(session.entry.busy, false);
    assert.equal(session.entry.cancellable, false);
    assert.equal(session.maintenanceDialog.running, false);
    assert.match(method === 'startMaintenanceOperation' ? session.maintenanceDialog.error : session.entry.error, /Transport disconnected/);
  });
}

test('an old entry request cannot clear a newer busy state or publish after disposal', async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const session = useLibrarySession({ api: { openLibrary: () => ++calls === 1 ? first.promise : second.promise }, showToastMessage: noop });
  const a = session.openLibraryPath('first'), b = session.openLibraryPath('second');
  first.reject(new Error('Old request failed')); await a;
  assert.equal(session.entry.busy, true); assert.equal(session.entry.error, '');
  session.dispose(); second.resolve({ ok: true, library: { active: { root: 'second' } } }); await b;
  assert.equal(session.view.value, 'library-entry'); assert.equal(session.libraryState.value.active, null);
});

function registryFixture(useRegistry, api) {
  const selectedItem = ref({ MediaId: 'first' }), editDraft = reactive({ TagIds: [], PersonIds: [], AlbumId: null, LocationId: null });
  let refreshes = 0;
  const query = reactive({ filters: { tag: [], person: [], album: [], location: [], locationRegion: [] } });
  const state = useRegistry({ api, selectedItem, editDraft, query, batchEdit: reactive({ tagIds: [], personIds: [], albumId: null, locationId: null }), orderedItems: ref([]),
    gallerySettingsOpen: ref(false), unassignedFilter: 'unassigned', recentTags: ref([]), recentPeople: ref([]), recentLocations: ref([]),
    rememberRecentTag: noop, rememberRecentPerson: noop, rememberRecentLocation: noop, pruneRecentTags: noop, pruneRecentPeople: noop, pruneRecentLocations: noop,
    showToastMessage: noop, requestEdit: noop, queryGallery: async () => { refreshes++; }, applyFilterSort: noop });
  return { state, selectedItem, editDraft, query, refreshes: () => refreshes };
}

for (const [kind, useRegistry, label, responseKey] of [
  ['tag', useTagRegistry, 'text', 'tags'], ['person', usePersonRegistry, 'name', 'people'],
  ['album', useAlbumRegistry, 'title', 'albums'], ['location', useLocationRegistry, 'name', 'locations'],
]) {
  const cap = kind[0].toUpperCase() + kind.slice(1);
  test(`${kind} creation prevents repeat submission and ignores replaced media/library responses`, async () => {
    const pending = deferred(); let calls = 0;
    const f = registryFixture(useRegistry, { ['create' + cap]: () => { calls++; return pending.promise; } });
    f.state['openCreate' + cap + 'Menu']('viewer');
    Object.assign(f.state[kind + 'Create'], { [label]: 'New', description: 'Description' });
    const first = f.state['create' + cap + 'AndSelect']();
    await f.state['create' + cap + 'AndSelect']();
    assert.equal(calls, 1); assert.equal(f.state[kind + 'Manager'].saving, true);
    f.selectedItem.value = { MediaId: 'replacement' };
    pending.resolve({ ok: true, [responseKey]: [{ [cap + 'Id']: 'new', [label[0].toUpperCase() + label.slice(1)]: 'New' }], [kind]: { [cap + 'Id']: 'new' } });
    await first;
    assert.equal(f.state[kind + 'Manager'].saving, false);
    assert.deepEqual(f.editDraft, { TagIds: [], PersonIds: [], AlbumId: null, LocationId: null });
    const late = deferred();
    const g = registryFixture(useRegistry, { ['create' + cap]: () => late.promise });
    g.state['openCreate' + cap + 'Menu']('manager'); Object.assign(g.state[kind + 'Create'], { [label]: 'New', description: 'Description' });
    const request = g.state['create' + cap + 'AndSelect']();
    g.state['reset' + cap + 'State'](); late.reject(new Error('Old library error')); await request;
    assert.equal(g.state[kind + 'Create'].error, ''); assert.equal(g.state[kind + 'Manager'].saving, false);
    assert.deepEqual(g.state[kind + 'Registry'].value, []);
  });
  test(`${kind} creation recovers after IPC rejection`, async () => {
    const f = registryFixture(useRegistry, { ['create' + cap]: async () => { throw new Error('Disconnected'); } });
    f.state['openCreate' + cap + 'Menu']('manager'); Object.assign(f.state[kind + 'Create'], { [label]: 'New', description: 'Description' });
    await f.state['create' + cap + 'AndSelect']();
    assert.match(f.state[kind + 'Create'].error, /Disconnected/); assert.equal(f.state[kind + 'Manager'].saving, false);
  });
}

test('deleting an unused intermediate location refreshes its ancestor filter', async t => {
  browser(t);
  const locations = [{ LocationId: 'parent', Name: 'Parent', ParentId: null }, { LocationId: 'middle', Name: 'Middle', ParentId: 'parent', ChildrenIds: ['child'] }, { LocationId: 'child', Name: 'Child', ParentId: 'middle' }];
  const f = registryFixture(useLocationRegistry, { listLocations: async () => ({ ok: true, locations }), deleteLocationGlobally: async () => ({ ok: true, updatedCount: 0, orphanedChildren: 1, locations: [locations[0], { ...locations[2], ParentId: null }] }) });
  await f.state.loadLocations(); f.query.filters.location = ['parent'];
  await f.state.deleteLocationGlobally(locations[1]); assert.equal(f.refreshes(), 1);
});

test('viewer navigation follows MediaId after reordering and preserves an absent dirty item', t => {
  browser(t);
  const a = { MediaId: 'a' }, b = { MediaId: 'b' }, c = { MediaId: 'c' };
  const selectedItem = ref(b), orderedItems = ref([a, b, c]), editingDirty = ref(false); const notices = [];
  const viewer = useMediaViewer({ api: {}, config: ref({}), selectedItem, orderedItems, editingDirty, saving: ref(false), view: ref('viewer'),
    setDraftFromItem: noop, closeRegistryDropdowns: noop, resetMediaTransform: noop, releaseCurrentMedia: noop, resetVideoPlaybackState: noop, showToastMessage: value => notices.push(value) });
  orderedItems.value = [b, a, c]; viewer.switchPhoto(1); assert.equal(selectedItem.value.MediaId, 'a');
  editingDirty.value = true; orderedItems.value = [b, c]; viewer.switchPhoto(1);
  assert.equal(selectedItem.value.MediaId, 'a'); assert.equal(viewer.pendingViewerTransition.visible, false);
  assert.match(notices.at(-1), /no longer/);
});


test('registry refresh prunes only removed selections and retains Unassigned', async () => {
  const f = registryFixture(useTagRegistry, {listTags: async () => ({ok:true,tags:[{TagId:'kept',Text:'Kept'}]})});
  f.query.filters.tag = ['gone','kept','unassigned'];
  await f.state.loadTags();
  assert.deepEqual(f.query.filters.tag, ['kept','unassigned']);
});

test('location modifiers combine regions, concrete locations and Unassigned', async () => {
  const f = registryFixture(useLocationRegistry, {});
  const country = {level:'country',country:'Country',province:'',city:''};
  await f.state.setLocationRegionFilter(country);
  await f.state.setLocationFilter('beach', true);
  await f.state.setLocationFilter('unassigned', true);
  assert.deepEqual(f.query.filters.location, ['beach','unassigned']);
  assert.deepEqual(f.query.filters.locationRegion, [country]);
  await f.state.setLocationRegionFilter({...country}, true);
  assert.deepEqual(f.query.filters.locationRegion, []);
  await f.state.setLocationFilter('', true);
  assert.deepEqual(f.query.filters.location, []);
});

test('location manager folds to cities, restores search state, and protects active editors', async () => {
  const region = { Country: 'Country', Province: 'Province', City: 'City' };
  const locations = [
    { ...region, LocationId: 'parent', Name: 'Campus', ParentId: null },
    { ...region, LocationId: 'child', Name: 'Building', ParentId: 'parent' },
  ];
  const { state: s } = registryFixture(useLocationRegistry, { listLocations: async () => ({ ok: true, locations }) });
  const labels = () => s.managerLocationRows.value.map(row => row.Label);
  await s.openLocationManager();
  assert.deepEqual(labels(), ['Country', 'Province', 'City']);
  const city = s.managerLocationRows.value.at(-1);
  s.toggleManagerRow(city);
  assert.deepEqual(labels(), ['Country', 'Province', 'City', 'Campus']);
  const parent = s.managerLocationRows.value.at(-1);
  s.locationManager.search = 'Building';
  assert.deepEqual(labels(), ['Country', 'Province', 'City', 'Campus', 'Building']);
  s.collapseManagerLocations();
  s.locationManager.search = '';
  assert.deepEqual(labels(), ['Country', 'Province', 'City', 'Campus']);
  s.toggleManagerRow(parent);
  s.startLocationEdit(locations[1]);
  assert.equal(s.managerFoldDisabled(parent), true);
  s.toggleManagerRow(parent); s.collapseManagerLocations();
  assert.ok(labels().includes('Building'));
  s.cancelLocationEdit(); s.collapseManagerLocations();
  assert.deepEqual(labels(), ['Country', 'Province', 'City']);
  s.expandManagerLocations(); assert.equal(labels().length, 5);
  s.closeLocationManager(); await s.openLocationManager();
  assert.deepEqual(labels(), ['Country', 'Province', 'City']);
});

test('location manager reveals newly created and moved cards', async () => {
  let locations = [{LocationId:'parent',Name:'Campus',Country:'Country',City:'City',ParentId:null}];
  const { state: s } = registryFixture(useLocationRegistry, {
    listLocations: async () => ({ok:true,locations}),
    createLocation: async () => { const location = {...locations[0],LocationId:'new',Name:'Building',ParentId:'parent'}; locations = [...locations,location]; return {ok:true,locations,location}; },
    updateLocation: async () => { locations = locations.map(l => l.LocationId === 'new' ? {...l,City:'Other',ParentId:null} : l); return {ok:true,locations}; },
  });
  await s.openLocationManager();
  s.openCreateLocationMenu('manager'); s.locationCreate.name = 'Building';
  await s.createLocationAndSelect();
  assert.ok(s.managerLocationRows.value.some(row => row.Location?.LocationId === 'new'));
  s.startLocationEdit(locations[1]); s.locationManager.editCity = 'Other'; s.locationManager.editParentId = null;
  await s.saveLocationEdit();
  assert.ok(s.managerLocationRows.value.some(row => row.Location?.LocationId === 'new'));
});

test('location manager counts descendants only on collapsed cards and refreshes totals', async () => {
  const region = {Country:'Country',City:'City'};
  let locations = [
    {...region,LocationId:'parent',Name:'Campus',ParentId:null,UsageCount:2},
    {...region,LocationId:'child',Name:'Building',ParentId:'parent',UsageCount:0},
    {...region,LocationId:'leaf',Name:'Room',ParentId:'child',UsageCount:3},
    {...region,LocationId:'other',Name:'Other',ParentId:null,UsageCount:1},
  ];
  const {state:s} = registryFixture(useLocationRegistry,{listLocations:async()=>({ok:true,locations})});
  await s.openLocationManager();
  s.toggleManagerRow(s.managerLocationRows.value.find(row=>row.Level==='city'));
  const row = id => s.managerLocationRows.value.find(row=>row.Location?.LocationId===id);
  assert.equal(s.managerLocationCount(row('parent')),5);
  assert.equal(s.managerLocationCount(row('other')),1);
  s.toggleManagerRow(row('parent'));
  assert.equal(s.managerLocationCount(row('parent')),2);
  assert.equal(s.managerLocationCount(row('child')),3);
  s.toggleManagerRow(row('child'));
  assert.equal(s.managerLocationCount(row('child')),0);
  assert.equal(s.managerLocationCount(row('leaf')),3);
  s.toggleManagerRow(row('parent'));
  s.locationManager.search='Room';
  assert.equal(s.managerLocationCount(row('parent')),2);
  s.locationManager.search='';
  assert.equal(s.managerLocationCount(row('parent')),5);
  locations=locations.map(item=>item.LocationId==='leaf'?{...item,UsageCount:7}:item);
  await s.loadLocations();
  assert.equal(s.managerLocationCount(row('parent')),9);
  assert.equal(row('parent').Location.UsageCount,2);
});

test('administrative count tooltips use full scoped direct usage independently of search and folding', async () => {
  let locations = [
    {LocationId:'city',Name:'Town',Country:'Country',Province:'North',City:'Town',UsageCount:1},
    {LocationId:'park',Name:'Park',Country:'Country',Province:'North',City:'Town',ParentId:'city',UsageCount:4},
    {LocationId:'other',Name:'Other',Country:'Country',Province:'South',City:'Town',UsageCount:2},
    {LocationId:'empty',Name:'Empty',Country:'Elsewhere',City:'Town',UsageCount:0},
  ];
  const {state:s}=registryFixture(useLocationRegistry,{listLocations:async()=>({ok:true,locations})});
  await s.openLocationManager();
  const city=s.managerLocationRows.value.find(row=>row.Location?.LocationId==='city');
  const south=s.managerLocationRows.value.find(row=>row.Level==='city' && row.Region.province==='South');
  const country=s.managerLocationRows.value.find(row=>row.Level==='country' && row.Label==='Country');
  assert.equal(s.managerRegionTooltip(city),'5 media items');
  assert.equal(s.managerRegionTooltip(south),'2 media items');
  assert.equal(s.managerRegionTooltip(country),'7 media items');
  assert.equal(s.managerRegionTooltip(s.managerLocationRows.value.find(row=>row.Level==='city' && row.Region.country==='Elsewhere')),'0 media items');
  s.expandManagerLocations(); s.locationManager.search='Park';
  assert.equal(s.managerRegionTooltip(country),'7 media items');
  assert.equal(s.managerRegionTooltip(city),'5 media items');
  assert.equal(s.managerRegionTooltip(s.managerLocationRows.value.find(row=>row.Location?.LocationId==='park')),'');
  locations=locations.map(item=>item.LocationId==='park'?{...item,UsageCount:0}:item);
  await s.loadLocations();
  assert.equal(s.managerRegionTooltip(city),'1 media item');
});
