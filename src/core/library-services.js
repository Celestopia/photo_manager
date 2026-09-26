const { DATA_FILE_NAMES, readJsonlStrict, writeJsonlAtomic } = require('./library-core');
const { createUniqueEntityId } = require('../shared/identity-schema');
const { createSimpleRegistryCatalog } = require('./simple-registry-catalog');
const { createSimpleRegistryService } = require('./simple-registry-service');
const { createLocationCatalog } = require('./location-catalog');
const { createLocationRegistryService } = require('./location-registry-service');
const { createLocationDomain, normalizeLocationField, normalizeLocationName, normalizeLocationObject } = require('./location-domain');
const { createGalleryQueryService } = require('./gallery-query');
const { createMetadataEditService } = require('./metadata-edit-service');

/** Assemble the same domain services for a GUI session or one CLI command. */
function createLibraryServices({ state, requireOpenLibrary, resolveDataFile, prepareLibraryWrite,
  touchLibraryManifest, saveMetadataMap, saveRegistryAndMetadataTransaction, enrichItem = item => item, appendLog }) {
  const UNASSIGNED_FILTER = '__UNASSIGNED__';
  const normalizeTagText = value => String(value ?? '').trim();
  const normalizePersonName = normalizeTagText;
  const normalizeAlbumTitle = normalizeTagText;
  const createRuntimeEntityId = () => createUniqueEntityId(id => [state.metadataIndex, state.tagRegistryIndex,
    state.albumRegistryIndex, state.personRegistryIndex, state.locationRegistryIndex].some(index => index.has(id)));
  const tagCatalog = createSimpleRegistryCatalog({
    idKey: "TagId",
    definitionKey: "Text",
    invalidKeyLabel: "tag key",
    dataFileName: DATA_FILE_NAMES.tags,
    backupReason: "tag-registry-write",
    normalize: normalizeTagText,
    extractReferences: (item) => Array.isArray(item?.Customization?.TagIds) ? item.Customization.TagIds : [],
    getRegistry: () => state.tagRegistryIndex,
    getMetadata: () => state.metadataIndex,
    resolveDataFile,
    prepareLibraryWrite,
    touchLibraryManifest,
    readJsonlStrict,
    writeJsonlAtomic,
  });
  const personCatalog = createSimpleRegistryCatalog({
    idKey: "PersonId",
    definitionKey: "Name",
    invalidKeyLabel: "person key",
    dataFileName: DATA_FILE_NAMES.people,
    backupReason: "person-registry-write",
    normalize: normalizePersonName,
    extractReferences: (item) => Array.isArray(item?.Customization?.PersonIds) ? item.Customization.PersonIds : [],
    getRegistry: () => state.personRegistryIndex,
    getMetadata: () => state.metadataIndex,
    resolveDataFile,
    prepareLibraryWrite,
    touchLibraryManifest,
    readJsonlStrict,
    writeJsonlAtomic,
  });
  const albumCatalog = createSimpleRegistryCatalog({
    idKey: "AlbumId",
    definitionKey: "Title",
    invalidKeyLabel: "album key",
    dataFileName: DATA_FILE_NAMES.albums,
    backupReason: "album-registry-write",
    normalize: normalizeAlbumTitle,
    normalizeLoadedDescription: normalizeAlbumTitle,
    extractReferences: (item) => {
      const albumId = item?.Customization?.AlbumId;
      return albumId ? [albumId] : [];
    },
    getRegistry: () => state.albumRegistryIndex,
    getMetadata: () => state.metadataIndex,
    resolveDataFile,
    prepareLibraryWrite,
    touchLibraryManifest,
    readJsonlStrict,
    writeJsonlAtomic,
  });
  const {
    buildLocationPath,
    getLocationChildrenMap,
    getLocationDepth,
    getLocationDescendants,
    getLocationIdsForRegion,
    validateLocationParent,
  } = createLocationDomain(() => state.locationRegistryIndex);
  const locationCatalog = createLocationCatalog({
    dataFileName: DATA_FILE_NAMES.locations,
    getRegistry: () => state.locationRegistryIndex,
    getMetadata: () => state.metadataIndex,
    normalizeField: normalizeLocationField,
    normalizeObject: normalizeLocationObject,
    getChildrenMap: getLocationChildrenMap,
    getDepth: getLocationDepth,
    buildPath: buildLocationPath,
    resolveDataFile,
    prepareLibraryWrite,
    touchLibraryManifest,
    readJsonlStrict,
    writeJsonlAtomic,
  });

  const listTagDefinitions = tagCatalog.listDefinitions;
  const getTagUsageCounts = tagCatalog.getUsageCounts;
  const saveTagRegistryMap = tagCatalog.save;
  const loadTagRegistryIndex = tagCatalog.load;
  const listPersonDefinitions = personCatalog.listDefinitions;
  const getPersonUsageCounts = personCatalog.getUsageCounts;
  const savePersonRegistryMap = personCatalog.save;
  const loadPersonRegistryIndex = personCatalog.load;
  const listAlbumDefinitions = albumCatalog.listDefinitions;
  const getAlbumUsageCounts = albumCatalog.getUsageCounts;
  const saveAlbumRegistryMap = albumCatalog.save;
  const loadAlbumRegistryIndex = albumCatalog.load;
  const listLocationDefinitions = locationCatalog.listDefinitions;
  const saveLocationRegistryMap = locationCatalog.save;
  const loadLocationRegistryIndex = locationCatalog.load;
  const normalizeRegisteredLocation = locationCatalog.normalizeRegistered;

  function normalizeRegisteredTags(rawTags) {
    const validation = tagCatalog.validateMany(rawTags);
    return { tagIds: validation.values, unknown: validation.unknown };
  }

  function normalizeRegisteredPeople(rawPeople) {
    const validation = personCatalog.validateMany(rawPeople);
    return { personIds: validation.values, unknown: validation.unknown };
  }

  function normalizeRegisteredAlbum(rawAlbum) {
    const validation = albumCatalog.validateOne(rawAlbum);
    return { albumId: validation.value, unknown: validation.unknown };
  }

  const { execute: executeGalleryQuery, groupByDate } = createGalleryQueryService({
    getLocationDescendants,
    getLocationIdsForRegion,
    unassignedFilter: UNASSIGNED_FILTER,
  });
  const commonRegistryOptions = {
    getMetadata: () => state.metadataIndex,
    requireOpenLibrary,
    prepareLibraryWrite,
    saveTransaction: saveRegistryAndMetadataTransaction,
    appendLog,
    createId: createRuntimeEntityId,
  };
  const tagService = createSimpleRegistryService({
    ...commonRegistryOptions,
    kind: "Tag",
    keyLabel: "Tag text",
    idKey: "TagId",
    definitionKey: "Text",
    responseItemKey: "tag",
    responseListKey: "tags",
    dataFileName: DATA_FILE_NAMES.tags,
    descriptionRequired: false,
    normalize: normalizeTagText,
    payloadKey: "text",
    payloadIdKey: "tagId",
    getRegistry: () => state.tagRegistryIndex,
    setRegistry: (next) => { state.tagRegistryIndex = next; },
    saveRegistry: saveTagRegistryMap,
    listDefinitions: listTagDefinitions,
    getUsageCounts: getTagUsageCounts,
    findByLabel: tagCatalog.findByLabel,
    sortEntries: (values) => [...values].sort((a, b) => a.Text.localeCompare(b.Text, "en-US")),
    updateMetadataOnDelete: (item, tagId, now) => {
      const tagIds = Array.isArray(item?.Customization?.TagIds) ? item.Customization.TagIds : [];
      if (!tagIds.includes(tagId)) return null;
      return {
        ...item,
        Customization: {
          ...(item.Customization || {}),
          TagIds: tagIds.filter((id) => id !== tagId),
          MetadataUpdateDate: now,
        },
      };
    },
  });
  const personService = createSimpleRegistryService({
    ...commonRegistryOptions,
    kind: "Person",
    keyLabel: "Person name",
    idKey: "PersonId",
    definitionKey: "Name",
    responseItemKey: "person",
    responseListKey: "people",
    dataFileName: DATA_FILE_NAMES.people,
    descriptionRequired: false,
    normalize: normalizePersonName,
    payloadKey: "name",
    payloadIdKey: "personId",
    getRegistry: () => state.personRegistryIndex,
    setRegistry: (next) => { state.personRegistryIndex = next; },
    saveRegistry: savePersonRegistryMap,
    listDefinitions: listPersonDefinitions,
    getUsageCounts: getPersonUsageCounts,
    findByLabel: personCatalog.findByLabel,
    sortEntries: (values) => [...values].sort((a, b) => a.Name.localeCompare(b.Name, "en-US")),
    updateMetadataOnDelete: (item, personId, now) => {
      const personIds = Array.isArray(item?.Customization?.PersonIds) ? item.Customization.PersonIds : [];
      if (!personIds.includes(personId)) return null;
      return {
        ...item,
        Customization: {
          ...(item.Customization || {}),
          PersonIds: personIds.filter((id) => id !== personId),
          MetadataUpdateDate: now,
        },
      };
    },
  });
  const albumService = createSimpleRegistryService({
    ...commonRegistryOptions,
    kind: "Album",
    keyLabel: "Album title",
    idKey: "AlbumId",
    definitionKey: "Title",
    responseItemKey: "album",
    responseListKey: "albums",
    dataFileName: DATA_FILE_NAMES.albums,
    descriptionRequired: true,
    normalize: normalizeAlbumTitle,
    payloadKey: "title",
    payloadIdKey: "albumId",
    getRegistry: () => state.albumRegistryIndex,
    setRegistry: (next) => { state.albumRegistryIndex = next; },
    saveRegistry: saveAlbumRegistryMap,
    listDefinitions: listAlbumDefinitions,
    getUsageCounts: getAlbumUsageCounts,
    findByLabel: albumCatalog.findByLabel,
    sortEntries: (values) => [...values].sort((a, b) => a.Title.localeCompare(b.Title, "en-US")),
    updateMetadataOnDelete: (item, albumId, now) => {
      if (item?.Customization?.AlbumId !== albumId) return null;
      return {
        ...item,
        Customization: {
          ...(item.Customization || {}),
          AlbumId: null,
          MetadataUpdateDate: now,
        },
      };
    },
  });
  const locationService = createLocationRegistryService({
    ...commonRegistryOptions,
    dataFileName: DATA_FILE_NAMES.locations,
    getRegistry: () => state.locationRegistryIndex,
    setRegistry: (next) => { state.locationRegistryIndex = next; },
    normalizeName: normalizeLocationName,
    normalizeField: normalizeLocationField,
    validateParent: validateLocationParent,
    getDepth: getLocationDepth,
    buildPath: buildLocationPath,
    listDefinitions: listLocationDefinitions,
    findDuplicate: locationCatalog.findDuplicate,
    sortEntries: locationCatalog.sortEntries,
    saveRegistry: saveLocationRegistryMap,
  });
  const metadataEditService = createMetadataEditService({
    getMetadata: () => state.metadataIndex,
    requireOpenLibrary,
    normalizeRegisteredTags,
    normalizeRegisteredAlbum,
    normalizeRegisteredPeople,
    normalizeRegisteredLocation,
    normalizeLocationObject,
    saveMetadata: saveMetadataMap,
    enrichItem,
    appendLog,
  });

  return { listTagDefinitions, getTagUsageCounts, saveTagRegistryMap, loadTagRegistryIndex, listPersonDefinitions, savePersonRegistryMap, loadPersonRegistryIndex, listAlbumDefinitions, saveAlbumRegistryMap, loadAlbumRegistryIndex, listLocationDefinitions, saveLocationRegistryMap, loadLocationRegistryIndex, normalizeRegisteredLocation, normalizeRegisteredTags, normalizeRegisteredPeople, normalizeRegisteredAlbum, executeGalleryQuery, groupByDate, buildLocationPath, getLocationChildrenMap, getLocationDepth, getLocationDescendants, getLocationIdsForRegion, validateLocationParent,
    services: { tagService, personService, albumService, locationService, metadataEditService } };
}
module.exports = { createLibraryServices };
