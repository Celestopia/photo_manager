/**
 * Electron main-process entry.
 *
 * Responsibilities:
 * 1) Load and normalize runtime configuration.
 * 2) Load photo metadata index (JSONL -> in-memory Map).
 * 3) Serve IPC handlers for query/update/copy/window actions.
 * 4) Create and monitor the renderer window.
 */
const { app, BrowserWindow, ipcMain, clipboard, nativeImage } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const yaml = require("js-yaml");
const {
  normalizeThumbnailConfig,
  thumbnailAbsolutePath,
  ensureThumbnailsForItems,
} = require(path.join(__dirname, "..", "..", "scripts", "thumbnail-cache.js"));

const APP_ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_PATH = path.join(APP_ROOT, "config.yml");
const RENDERER_INDEX_PATH = path.join(APP_ROOT, "dist", "renderer", "index.html");
const DATA_FILE_NAMES = Object.freeze({
  metadata: "photo_metadata.jsonl",
  tags: "tag_registry.jsonl",
  albums: "album_registry.jsonl",
  people: "person_registry.jsonl",
  locations: "location_registry.jsonl",
});

const DEFAULT_CONFIG = {
  workspaceRoot: "./photo_workspace",
  dataDir: "./data",
  logDir: "./logs",
  thumbnail: {
    dir: "./thumb_cache",
    size: 320,
    webpQuality: 80,
    extremeAspectRatio: 4,
    maxConcurrency: 4,
  },
  ui: {
    language: "zh-CN",
    gallery: {
      pageSize: 120,
      minCardWidth: 190,
    },
    viewer: {
      panelRatio: {
        left: 1,
        center: 3,
        right: 1,
      },
      panels: {
        showLeft: true,
        showRight: true,
      },
      zoom: {
        minPercent: 10,
        maxPercent: 1000,
        stepPercent: 10,
      },
    },
  },
};

// Runtime singletons in the main process.
let mainWindow = null;
let config = null;
let metadataIndex = new Map();
let tagRegistryIndex = new Map();
let albumRegistryIndex = new Map();
let personRegistryIndex = new Map();
let locationRegistryIndex = new Map();
let thumbnailWarmupStarted = false;
const DEFAULT_TAG_DESCRIPTION = "待补充：请填写该标签的明确含义。";
const DEFAULT_ALBUM_DESCRIPTION = "待补充：请填写该相册的明确含义。";
const UNASSIGNED_ALBUM_FILTER = "__UNASSIGNED__";

/**
 * Force value into plain JSON-serializable structure.
 * This avoids IPC structured-clone failures when Vue/reactive objects leak in.
 */
function toSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Ensure config exists and always produce a fully merged config object.
 * If config file is invalid, fallback to defaults and log the issue.
 */
function ensureConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, yaml.dump(DEFAULT_CONFIG), "utf8");
    config = structuredClone(DEFAULT_CONFIG);
    return;
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = yaml.load(raw);
    config = {
      ...DEFAULT_CONFIG,
      ...parsed,
      thumbnail: {
        ...DEFAULT_CONFIG.thumbnail,
        ...(parsed?.thumbnail || {}),
      },
      ui: {
        ...DEFAULT_CONFIG.ui,
        ...(parsed?.ui || {}),
        gallery: {
          ...DEFAULT_CONFIG.ui.gallery,
          ...(parsed?.ui?.gallery || {}),
        },
        viewer: {
          ...DEFAULT_CONFIG.ui.viewer,
          ...(parsed?.ui?.viewer || {}),
          panelRatio: {
            ...DEFAULT_CONFIG.ui.viewer.panelRatio,
            ...(parsed?.ui?.viewer?.panelRatio || {}),
          },
          panels: {
            ...DEFAULT_CONFIG.ui.viewer.panels,
            ...(parsed?.ui?.viewer?.panels || {}),
          },
          zoom: {
            ...DEFAULT_CONFIG.ui.viewer.zoom,
            ...(parsed?.ui?.viewer?.zoom || {}),
          },
        },
      },
    };
  } catch (error) {
    config = structuredClone(DEFAULT_CONFIG);
    appendLog(`Invalid config.yml, fallback to default. ${error.message}`);
  }
}

/**

 * Check whether a value is a plain object (object literal style).

 * Used by deepMerge to avoid recursing into arrays or primitive values.

 */

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

/**

 * Recursively merge patch fields into a base object.

 * This keeps nested config sections intact when updating only part of config.yml.

 */

function deepMerge(base, patch) {
  const output = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

/**

 * Persist current in-memory config to config.yml.

 * Called after app:update-config succeeds in merging a patch.

 */

async function saveConfig() {
  const raw = yaml.dump(config);
  await fsp.writeFile(CONFIG_PATH, raw, "utf8");
}

/**
 * Resolve project-relative path to absolute path.
 */
function toAbsolutePath(possibleRelativePath) {
  if (path.isAbsolute(possibleRelativePath)) {
    return possibleRelativePath;
  }
  return path.resolve(APP_ROOT, possibleRelativePath);
}

function resolveDataDir() {
  return toAbsolutePath(config?.dataDir || DEFAULT_CONFIG.dataDir);
}

function resolveDataFile(fileName) {
  return path.join(resolveDataDir(), fileName);
}

async function ensureDataDirectory() {
  await fsp.mkdir(resolveDataDir(), { recursive: true });
}

/**
 * Append one line into date-partitioned log file under configured log directory.
 */
function appendLog(message) {
  try {
    const logDir = toAbsolutePath(config?.logDir || DEFAULT_CONFIG.logDir);
    fs.mkdirSync(logDir, { recursive: true });
    const dayKey = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(path.join(logDir, `${dayKey}.log`), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Ignore logging failures to avoid crash loops.
  }
}

/**
 * Read metadata JSONL into an in-memory Map keyed by FilePath.
 * Invalid lines are skipped so a partially broken metadata file does not block startup.
 */
async function loadMetadataIndex() {
  metadataIndex.clear();
  const metadataFile = resolveDataFile(DATA_FILE_NAMES.metadata);

  if (!fs.existsSync(metadataFile)) {
    return;
  }

  const content = await fsp.readFile(metadataFile, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item?.FilePath) {
        metadataIndex.set(item.FilePath, item);
      }
    } catch (error) {
      appendLog(`Skip invalid metadata line: ${error.message}`);
    }
  }
}

/**
 * Normalize tag text into the canonical key stored in photo metadata.
 */
function normalizeTagText(value) {
  return String(value ?? "").trim();
}

/**
 * Return tag definitions sorted by tag text, including current usage counts.
 */
function listTagDefinitions() {
  const usage = getTagUsageCounts();
  return [...tagRegistryIndex.values()]
    .map((tag) => ({
      ...tag,
      UsageCount: usage.get(tag.Text) || 0,
    }))
    .sort((a, b) => a.Text.localeCompare(b.Text, "zh-CN"));
}

/**
 * Count how many metadata records currently use each registered tag text.
 */
function getTagUsageCounts() {
  const counts = new Map();
  for (const item of metadataIndex.values()) {
    const tags = Array.isArray(item?.Customization?.Tags) ? item.Customization.Tags : [];
    for (const rawTag of tags) {
      const tag = normalizeTagText(rawTag);
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Persist tag registry JSONL using the same temp-file replacement style as metadata.
 */
async function saveTagRegistryMap() {
  await ensureDataDirectory();
  const registryFile = resolveDataFile(DATA_FILE_NAMES.tags);
  const tempFile = `${registryFile}.tmp`;
  const lines = [...tagRegistryIndex.values()]
    .sort((a, b) => a.Text.localeCompare(b.Text, "zh-CN"))
    .map((tag) => JSON.stringify(tag));
  await fsp.writeFile(tempFile, `${lines.join("\n")}${lines.length ? "\n" : ""}`, "utf8");
  await fsp.rename(tempFile, registryFile);
}

/**
 * Add missing registry definitions for tags already present in photo metadata.
 */
function seedRegistryFromMetadata() {
  const now = new Date().toISOString();
  let added = 0;

  for (const item of metadataIndex.values()) {
    const tags = Array.isArray(item?.Customization?.Tags) ? item.Customization.Tags : [];
    for (const rawTag of tags) {
      const tagText = normalizeTagText(rawTag);
      if (!tagText || tagRegistryIndex.has(tagText)) continue;
      tagRegistryIndex.set(tagText, {
        Text: tagText,
        Description: DEFAULT_TAG_DESCRIPTION,
        CreatedAt: now,
        UpdatedAt: now,
      });
      added += 1;
    }
  }

  return added;
}

/**
 * Read the tag registry JSONL into memory, then backfill definitions for legacy tags.
 */
async function loadTagRegistryIndex() {
  tagRegistryIndex.clear();
  const registryFile = resolveDataFile(DATA_FILE_NAMES.tags);
  const fileExists = fs.existsSync(registryFile);

  if (fileExists) {
    const content = await fsp.readFile(registryFile, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const text = normalizeTagText(parsed?.Text);
        if (!text) continue;
        const createdAt = typeof parsed?.CreatedAt === "string" ? parsed.CreatedAt : new Date().toISOString();
        const updatedAt = typeof parsed?.UpdatedAt === "string" ? parsed.UpdatedAt : createdAt;
        tagRegistryIndex.set(text, {
          Text: text,
          Description: normalizeTagText(parsed?.Description) || DEFAULT_TAG_DESCRIPTION,
          CreatedAt: createdAt,
          UpdatedAt: updatedAt,
        });
      } catch (error) {
        appendLog(`Skip invalid tag registry line: ${error.message}`);
      }
    }
  }

  const added = seedRegistryFromMetadata();
  if (!fileExists || added > 0) {
    await saveTagRegistryMap();
  }
}

/**
 * Normalize and validate tag arrays before writing photo metadata.
 */
function normalizeRegisteredTags(rawTags) {
  const tags = Array.isArray(rawTags) ? rawTags : [];
  const normalized = [...new Set(tags.map(normalizeTagText).filter(Boolean))];
  const unknown = normalized.filter((tag) => !tagRegistryIndex.has(tag));
  return { tags: normalized, unknown };
}

/**
 * Normalize person name into the canonical key stored in photo metadata.
 */
function normalizePersonName(value) {
  return String(value ?? "").trim();
}

/**
 * Count how many metadata records currently reference each registered person.
 */
function getPersonUsageCounts() {
  const counts = new Map();
  for (const item of metadataIndex.values()) {
    const people = Array.isArray(item?.Customization?.People) ? item.Customization.People : [];
    for (const rawPerson of people) {
      const person = normalizePersonName(rawPerson);
      if (!person) continue;
      counts.set(person, (counts.get(person) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Return person definitions sorted by name, including current usage counts.
 */
function listPersonDefinitions() {
  const usage = getPersonUsageCounts();
  return [...personRegistryIndex.values()]
    .map((person) => ({
      ...person,
      UsageCount: usage.get(person.Name) || 0,
    }))
    .sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN"));
}

/**
 * Persist person registry JSONL using temp-file replacement.
 */
async function savePersonRegistryMap() {
  await ensureDataDirectory();
  const registryFile = resolveDataFile(DATA_FILE_NAMES.people);
  const tempFile = `${registryFile}.tmp`;
  const lines = [...personRegistryIndex.values()]
    .sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN"))
    .map((person) => JSON.stringify(person));
  await fsp.writeFile(tempFile, `${lines.join("\n")}${lines.length ? "\n" : ""}`, "utf8");
  await fsp.rename(tempFile, registryFile);
}

/**
 * Add missing registry definitions for people already present in photo metadata.
 */
function seedPersonRegistryFromMetadata() {
  const now = new Date().toISOString();
  let added = 0;

  for (const item of metadataIndex.values()) {
    const people = Array.isArray(item?.Customization?.People) ? item.Customization.People : [];
    for (const rawPerson of people) {
      const name = normalizePersonName(rawPerson);
      if (!name || personRegistryIndex.has(name)) continue;
      personRegistryIndex.set(name, {
        Name: name,
        Description: "",
        CreatedAt: now,
        UpdatedAt: now,
      });
      added += 1;
    }
  }

  return added;
}

/**
 * Read the person registry JSONL into memory, then backfill legacy people.
 */
async function loadPersonRegistryIndex() {
  personRegistryIndex.clear();
  const registryFile = resolveDataFile(DATA_FILE_NAMES.people);
  const fileExists = fs.existsSync(registryFile);

  if (fileExists) {
    const content = await fsp.readFile(registryFile, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const name = normalizePersonName(parsed?.Name);
        if (!name) continue;
        const createdAt = typeof parsed?.CreatedAt === "string" ? parsed.CreatedAt : new Date().toISOString();
        const updatedAt = typeof parsed?.UpdatedAt === "string" ? parsed.UpdatedAt : createdAt;
        personRegistryIndex.set(name, {
          Name: name,
          Description: normalizePersonName(parsed?.Description),
          CreatedAt: createdAt,
          UpdatedAt: updatedAt,
        });
      } catch (error) {
        appendLog(`Skip invalid person registry line: ${error.message}`);
      }
    }
  }

  const added = seedPersonRegistryFromMetadata();
  if (!fileExists || added > 0) {
    await savePersonRegistryMap();
  }
}

/**
 * Normalize and validate person arrays before writing photo metadata.
 */
function normalizeRegisteredPeople(rawPeople) {
  const people = Array.isArray(rawPeople) ? rawPeople : [];
  const normalized = [...new Set(people.map(normalizePersonName).filter(Boolean))];
  const unknown = normalized.filter((person) => !personRegistryIndex.has(person));
  return { people: normalized, unknown };
}
/**
 * Normalize location text fields into canonical registry strings.
 */
function normalizeLocationName(value) {
  return String(value ?? "").trim();
}

function normalizeLocationField(value) {
  return String(value ?? "").trim();
}

function normalizeLocationObject(rawLocation) {
  const source = rawLocation && typeof rawLocation === "object" ? rawLocation : {};
  return {
    Place: normalizeLocationName(source.Place ?? source.Site),
    Detail: normalizeLocationField(source.Detail),
  };
}

function getLocationUsageCounts() {
  const counts = new Map();
  for (const item of metadataIndex.values()) {
    const place = normalizeLocationName(item?.Location?.Place ?? item?.Location?.Site);
    if (!place) continue;
    counts.set(place, (counts.get(place) || 0) + 1);
  }
  return counts;
}

function getLocationChildrenMap() {
  const children = new Map();
  for (const location of locationRegistryIndex.values()) {
    if (!children.has(location.Name)) children.set(location.Name, []);
  }
  for (const location of locationRegistryIndex.values()) {
    const parent = normalizeLocationName(location.Parent);
    if (!parent || !locationRegistryIndex.has(parent)) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(location.Name);
  }
  for (const names of children.values()) {
    names.sort((a, b) => a.localeCompare(b, "zh-CN"));
  }
  return children;
}

function getLocationDescendants(name) {
  const root = normalizeLocationName(name);
  const children = getLocationChildrenMap();
  const output = [];
  const stack = [...(children.get(root) || [])];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    output.push(current);
    stack.push(...(children.get(current) || []));
  }
  return output;
}

function buildLocationPath(name) {
  const parts = [];
  const seen = new Set();
  let current = normalizeLocationName(name);
  while (current && locationRegistryIndex.has(current) && !seen.has(current)) {
    seen.add(current);
    parts.unshift(current);
    current = normalizeLocationName(locationRegistryIndex.get(current)?.Parent);
  }
  return parts;
}

function getLocationDepth(name) {
  return Math.max(0, buildLocationPath(name).length - 1);
}

function validateLocationParent(name, parent) {
  const normalizedName = normalizeLocationName(name);
  const normalizedParent = normalizeLocationName(parent);
  if (!normalizedParent) return { ok: true, parent: "" };
  if (!locationRegistryIndex.has(normalizedParent)) {
    return { ok: false, error: "Parent location not found" };
  }
  if (normalizedParent === normalizedName) {
    return { ok: false, error: "Location cannot be its own parent" };
  }
  if (normalizedName && getLocationDescendants(normalizedName).includes(normalizedParent)) {
    return { ok: false, error: "Parent cannot be a descendant location" };
  }
  return { ok: true, parent: normalizedParent };
}

function listLocationDefinitions() {
  const usage = getLocationUsageCounts();
  const children = getLocationChildrenMap();
  return [...locationRegistryIndex.values()]
    .map((location) => ({
      ...location,
      UsageCount: usage.get(location.Name) || 0,
      Children: children.get(location.Name) || [],
      Depth: getLocationDepth(location.Name),
      Path: buildLocationPath(location.Name),
    }))
    .sort((a, b) => a.Path.join("/").localeCompare(b.Path.join("/"), "zh-CN"));
}

async function saveLocationRegistryMap() {
  await ensureDataDirectory();
  const registryFile = resolveDataFile(DATA_FILE_NAMES.locations);
  const tempFile = `${registryFile}.tmp`;
  const lines = [...locationRegistryIndex.values()]
    .sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN"))
    .map((location) => JSON.stringify(location));
  await fsp.writeFile(tempFile, `${lines.join("\n")}${lines.length ? "\n" : ""}`, "utf8");
  await fsp.rename(tempFile, registryFile);
}

function upsertLocationFromMetadata(name, sourceLocation, now) {
  const locationName = normalizeLocationName(name);
  if (!locationName || locationRegistryIndex.has(locationName)) return false;
  locationRegistryIndex.set(locationName, {
    Name: locationName,
    Country: normalizeLocationField(sourceLocation?.Country),
    Province: normalizeLocationField(sourceLocation?.Province),
    City: normalizeLocationField(sourceLocation?.City),
    Parent: "",
    Description: "",
    CreatedAt: now,
    UpdatedAt: now,
  });
  return true;
}

function normalizeAllMetadataLocations() {
  const now = new Date().toISOString();
  let registryAdded = 0;
  let metadataChanged = 0;

  for (const [filePath, item] of metadataIndex.entries()) {
    const original = item?.Location && typeof item.Location === "object" ? item.Location : {};
    const place = normalizeLocationName(original.Place ?? original.Site);
    const detail = normalizeLocationField(original.Detail);

    if (place && upsertLocationFromMetadata(place, original, now)) {
      registryAdded += 1;
    }

    const nextLocation = { Place: place, Detail: detail };
    if (original.Place !== nextLocation.Place || original.Detail !== nextLocation.Detail || Object.keys(original).some((key) => !["Place", "Detail"].includes(key))) {
      item.Location = nextLocation;
      item.Customization = {
        ...(item.Customization || {}),
        MetadataUpdateDate: item?.Customization?.MetadataUpdateDate || now,
      };
      metadataIndex.set(filePath, item);
      metadataChanged += 1;
    }
  }

  return { registryAdded, metadataChanged };
}

function sanitizeLocationParentLinks() {
  let changed = 0;
  for (const [name, location] of locationRegistryIndex.entries()) {
    const parent = normalizeLocationName(location.Parent);
    if (!parent) {
      if (location.Parent !== "") {
        locationRegistryIndex.set(name, { ...location, Parent: "", UpdatedAt: new Date().toISOString() });
        changed += 1;
      }
      continue;
    }
    const validation = validateLocationParent(name, parent);
    if (!validation.ok) {
      locationRegistryIndex.set(name, { ...location, Parent: "", UpdatedAt: new Date().toISOString() });
      changed += 1;
    }
  }
  return changed;
}

async function loadLocationRegistryIndex() {
  locationRegistryIndex.clear();
  const registryFile = resolveDataFile(DATA_FILE_NAMES.locations);
  const fileExists = fs.existsSync(registryFile);

  if (fileExists) {
    const content = await fsp.readFile(registryFile, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const name = normalizeLocationName(parsed?.Name);
        if (!name) continue;
        const createdAt = typeof parsed?.CreatedAt === "string" ? parsed.CreatedAt : new Date().toISOString();
        const updatedAt = typeof parsed?.UpdatedAt === "string" ? parsed.UpdatedAt : createdAt;
        locationRegistryIndex.set(name, {
          Name: name,
          Country: normalizeLocationField(parsed?.Country),
          Province: normalizeLocationField(parsed?.Province),
          City: normalizeLocationField(parsed?.City),
          Parent: normalizeLocationName(parsed?.Parent),
          Description: normalizeLocationField(parsed?.Description),
          CreatedAt: createdAt,
          UpdatedAt: updatedAt,
        });
      } catch (error) {
        appendLog(`Skip invalid location registry line: ${error.message}`);
      }
    }
  }

  const normalized = normalizeAllMetadataLocations();
  const parentFixes = sanitizeLocationParentLinks();
  if (!fileExists || normalized.registryAdded > 0 || parentFixes > 0) {
    await saveLocationRegistryMap();
  }
  if (normalized.metadataChanged > 0) {
    await saveMetadataMap();
  }
}

function normalizeRegisteredLocation(rawLocation) {
  const location = normalizeLocationObject(rawLocation);
  const unknown = location.Place && !locationRegistryIndex.has(location.Place) ? [location.Place] : [];
  return { location, unknown };
}
/**
 * Normalize album title into the canonical string stored on photo metadata.
 */
function normalizeAlbumTitle(value) {
  return String(value ?? "").trim();
}

/**
 * Count how many metadata records currently use each registered album title.
 */
function getAlbumUsageCounts() {
  const counts = new Map();
  for (const item of metadataIndex.values()) {
    const album = normalizeAlbumTitle(item?.Customization?.Album);
    if (!album) continue;
    counts.set(album, (counts.get(album) || 0) + 1);
  }
  return counts;
}

/**
 * Return album definitions sorted by title, including current usage counts.
 */
function listAlbumDefinitions() {
  const usage = getAlbumUsageCounts();
  return [...albumRegistryIndex.values()]
    .map((album) => ({
      ...album,
      UsageCount: usage.get(album.Title) || 0,
    }))
    .sort((a, b) => a.Title.localeCompare(b.Title, "zh-CN"));
}

/**
 * Persist album registry JSONL using temp-file replacement.
 */
async function saveAlbumRegistryMap() {
  await ensureDataDirectory();
  const registryFile = resolveDataFile(DATA_FILE_NAMES.albums);
  const tempFile = `${registryFile}.tmp`;
  const lines = [...albumRegistryIndex.values()]
    .sort((a, b) => a.Title.localeCompare(b.Title, "zh-CN"))
    .map((album) => JSON.stringify(album));
  await fsp.writeFile(tempFile, `${lines.join("\n")}${lines.length ? "\n" : ""}`, "utf8");
  await fsp.rename(tempFile, registryFile);
}

/**
 * Add missing registry definitions for albums already present in photo metadata.
 */
function seedAlbumRegistryFromMetadata() {
  const now = new Date().toISOString();
  let added = 0;

  for (const item of metadataIndex.values()) {
    const title = normalizeAlbumTitle(item?.Customization?.Album);
    if (!title || albumRegistryIndex.has(title)) continue;
    albumRegistryIndex.set(title, {
      Title: title,
      Description: DEFAULT_ALBUM_DESCRIPTION,
      CreatedAt: now,
      UpdatedAt: now,
    });
    added += 1;
  }

  return added;
}

/**
 * Read the album registry JSONL into memory, then backfill legacy albums.
 */
async function loadAlbumRegistryIndex() {
  albumRegistryIndex.clear();
  const registryFile = resolveDataFile(DATA_FILE_NAMES.albums);
  const fileExists = fs.existsSync(registryFile);

  if (fileExists) {
    const content = await fsp.readFile(registryFile, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const title = normalizeAlbumTitle(parsed?.Title);
        if (!title) continue;
        const createdAt = typeof parsed?.CreatedAt === "string" ? parsed.CreatedAt : new Date().toISOString();
        const updatedAt = typeof parsed?.UpdatedAt === "string" ? parsed.UpdatedAt : createdAt;
        albumRegistryIndex.set(title, {
          Title: title,
          Description: normalizeAlbumTitle(parsed?.Description) || DEFAULT_ALBUM_DESCRIPTION,
          CreatedAt: createdAt,
          UpdatedAt: updatedAt,
        });
      } catch (error) {
        appendLog(`Skip invalid album registry line: ${error.message}`);
      }
    }
  }

  const added = seedAlbumRegistryFromMetadata();
  if (!fileExists || added > 0) {
    await saveAlbumRegistryMap();
  }
}

/**
 * Normalize and validate a photo album value before writing metadata.
 */
function normalizeRegisteredAlbum(rawAlbum) {
  const album = normalizeAlbumTitle(rawAlbum);
  const unknown = album && !albumRegistryIndex.has(album) ? [album] : [];
  return { album, unknown };
}

/**
 * Apply gallery-level filtering/searching/sorting in memory.
 * Filter semantics match the requirement document:
 * - hidden items are excluded
 * - Album/Tag filters are intersected
 * - search is exact substring matching
 */
function filterAndSort(list, options) {
  const { filters, search, sortBy, sortOrder } = options;

  let output = list.filter((item) => !item?.Customization?.Hidden);

  if (filters.album === UNASSIGNED_ALBUM_FILTER) {
    output = output.filter((item) => !normalizeAlbumTitle(item?.Customization?.Album));
  } else if (filters.album) {
    output = output.filter((item) => item?.Customization?.Album === filters.album);
  }

  if (filters.tag) {
    output = output.filter((item) => Array.isArray(item?.Customization?.Tags) && item.Customization.Tags.includes(filters.tag));
  }

  if (filters.person) {
    output = output.filter((item) => Array.isArray(item?.Customization?.People) && item.Customization.People.includes(filters.person));
  }

  if (filters.location) {
    const allowedLocations = new Set([normalizeLocationName(filters.location), ...getLocationDescendants(filters.location)]);
    output = output.filter((item) => allowedLocations.has(normalizeLocationName(item?.Location?.Place ?? item?.Location?.Site)));
  }

  if (search?.value && search?.field) {
    output = output.filter((item) => {
      const keyword = search.value;
      const fieldValue = (() => {
        if (search.field === "title") return item?.Customization?.Title || "";
        if (search.field === "filename") return path.basename(item?.FilePath || "");
        if (search.field === "description") return item?.Customization?.Description || "";
        return "";
      })();
      return fieldValue.includes(keyword);
    });
  }

  output.sort((a, b) => {
    let va;
    let vb;

    if (sortBy === "filename") {
      va = path.basename(a.FilePath || "");
      vb = path.basename(b.FilePath || "");
    } else if (sortBy === "rating") {
      va = a?.Customization?.Rating || 0;
      vb = b?.Customization?.Rating || 0;
    } else {
      va = a?.FileSystem?.ShootingTimeString || "";
      vb = b?.FileSystem?.ShootingTimeString || "";
    }

    if (va < vb) return sortOrder === "asc" ? -1 : 1;
    if (va > vb) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  return output;
}

/**
 * Inject renderer-facing helper fields:
 * - absolute file path for image loading/copy
 * - date grouping key for gallery sections
 */
function enrichItem(item) {
  const workspaceRoot = toAbsolutePath(config.workspaceRoot);
  const thumbnailConfig = normalizeThumbnailConfig(config.thumbnail);
  const thumbnailDir = toAbsolutePath(thumbnailConfig.dir);
  const absPath = path.join(workspaceRoot, item.FilePath);
  const thumbPath = item?.SHA256Hash ? thumbnailAbsolutePath(thumbnailDir, item.SHA256Hash) : "";
  return {
    ...item,
    __absolutePath: absPath,
    __thumbnailPath: thumbPath,
    __groupDate: (item?.FileSystem?.ShootingTimeString || "").slice(0, 10) || "Unknown",
  };
}

/**
 * Warm thumbnail cache in the background.
 * Gallery rendering can still fall back to original image paths while cache fills.
 */
async function warmupThumbnailCache() {
  if (thumbnailWarmupStarted) return;
  thumbnailWarmupStarted = true;

  const thumbnailConfig = normalizeThumbnailConfig(config.thumbnail);
  const workspaceRoot = toAbsolutePath(config.workspaceRoot);
  const thumbnailDir = toAbsolutePath(thumbnailConfig.dir);
  const imageItems = [...metadataIndex.values()].filter((item) => item?.FileSystem?.FileType === "image");
  if (!imageItems.length) return;

  const stats = await ensureThumbnailsForItems(imageItems, {
    workspaceRoot,
    cacheDir: thumbnailDir,
    options: thumbnailConfig,
    maxConcurrency: thumbnailConfig.maxConcurrency,
    logger: (message) => appendLog(message),
  });
  appendLog(
    `thumbnail-warmup total=${stats.total} generated=${stats.generated} skipped=${stats.skipped} failed=${stats.failed}`,
  );
}

/**
 * Persist full metadata Map back to JSONL using atomic replace:
 * write temp file -> rename.
 */
async function saveMetadataMap() {
  await ensureDataDirectory();
  const metadataFile = resolveDataFile(DATA_FILE_NAMES.metadata);
  const tempFile = `${metadataFile}.tmp`;
  const lines = [...metadataIndex.values()].map((item) => JSON.stringify(item));
  await fsp.writeFile(tempFile, `${lines.join("\n")}${lines.length ? "\n" : ""}`, "utf8");
  await fsp.rename(tempFile, metadataFile);
}

/**
 * Register all IPC endpoints used by renderer.
 * Channels are intentionally explicit to keep the API surface narrow and auditable.
 */
function registerIpcHandlers() {
  ipcMain.handle("app:get-config", async () => toSerializable(config));
  ipcMain.handle("app:update-config", async (_, patch) => {
    try {
      config = deepMerge(config, patch || {});
      await saveConfig();
      return { ok: true, config: toSerializable(config) };
    } catch (error) {
      appendLog(`Failed to update config: ${error.message}`);
      return { ok: false, error: "Failed to update config" };
    }
  });

  ipcMain.handle("gallery:query", async (_, query) => {
    const all = [...metadataIndex.values()].map(enrichItem);
    const filtered = filterAndSort(all, query);

    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.max(1, Number(query.pageSize || config.ui.gallery.pageSize));
    const start = (page - 1) * pageSize;
    const pageItems = filtered.slice(start, start + pageSize);

    const grouped = new Map();
    for (const item of pageItems) {
      if (!grouped.has(item.__groupDate)) {
        grouped.set(item.__groupDate, []);
      }
      grouped.get(item.__groupDate).push(item);
    }

    // Pagination happens after filter/sort to keep UI behavior consistent.
    const unassignedAlbumCount = all.filter((item) => !normalizeAlbumTitle(item?.Customization?.Album)).length;
    const payload = {
      total: filtered.length,
      page,
      pageSize,
      hasMore: start + pageSize < filtered.length,
      groups: [...grouped.entries()].map(([date, items]) => ({ date, items })),
      filterOptions: {
        albums: [...albumRegistryIndex.keys()].sort((a, b) => a.localeCompare(b, "zh-CN")),
        unassignedAlbumCount,
        tags: [...tagRegistryIndex.keys()].sort((a, b) => a.localeCompare(b, "zh-CN")),
        people: [...personRegistryIndex.keys()].sort((a, b) => a.localeCompare(b, "zh-CN")),
        locations: listLocationDefinitions(),
      },
    };
    return toSerializable(payload);
  });

  ipcMain.handle("tag:list", async () => toSerializable({ ok: true, tags: listTagDefinitions() }));

  ipcMain.handle("tag:create", async (_, payload) => {
    const text = normalizeTagText(payload?.text ?? payload?.Text);
    const description = normalizeTagText(payload?.description ?? payload?.Description);
    if (!text) {
      return { ok: false, error: "Tag text is required" };
    }
    if (tagRegistryIndex.has(text)) {
      return { ok: false, error: "Tag already exists" };
    }

    const now = new Date().toISOString();
    const tag = { Text: text, Description: description, CreatedAt: now, UpdatedAt: now };
    tagRegistryIndex.set(text, tag);
    try {
      await saveTagRegistryMap();
      return toSerializable({ ok: true, tag: { ...tag, UsageCount: 0 }, tags: listTagDefinitions() });
    } catch (error) {
      tagRegistryIndex.delete(text);
      appendLog(`Failed to create tag: ${error.message}`);
      return { ok: false, error: "Failed to write tag registry" };
    }
  });

  ipcMain.handle("tag:update-description", async (_, payload) => {
    const text = normalizeTagText(payload?.text ?? payload?.Text);
    const description = normalizeTagText(payload?.description ?? payload?.Description);
    const current = tagRegistryIndex.get(text);
    if (!text) {
      return { ok: false, error: "Tag text is required" };
    }
    if (!current) {
      return { ok: false, error: "Tag not found" };
    }

    const previous = { ...current };
    const next = { ...current, Description: description, UpdatedAt: new Date().toISOString() };
    tagRegistryIndex.set(text, next);
    try {
      await saveTagRegistryMap();
      return toSerializable({ ok: true, tag: { ...next, UsageCount: getTagUsageCounts().get(text) || 0 }, tags: listTagDefinitions() });
    } catch (error) {
      tagRegistryIndex.set(text, previous);
      appendLog(`Failed to update tag description: ${error.message}`);
      return { ok: false, error: "Failed to write tag registry" };
    }
  });

  ipcMain.handle("tag:delete-global", async (_, payload) => {
    const text = normalizeTagText(payload?.text ?? payload?.Text);
    const current = tagRegistryIndex.get(text);
    if (!text || !current) {
      return { ok: false, error: "Tag not found" };
    }

    const previousRegistry = new Map(tagRegistryIndex);
    const previousMetadata = new Map([...metadataIndex.entries()].map(([key, value]) => [key, structuredClone(value)]));
    let updatedCount = 0;
    tagRegistryIndex.delete(text);

    for (const [filePath, item] of metadataIndex.entries()) {
      const tags = Array.isArray(item?.Customization?.Tags) ? item.Customization.Tags : [];
      if (!tags.includes(text)) continue;
      const nextTags = tags.filter((tag) => tag !== text);
      item.Customization = {
        ...(item.Customization || {}),
        Tags: nextTags,
        MetadataUpdateDate: new Date().toISOString(),
      };
      delete item.Customization.Category;
      metadataIndex.set(filePath, item);
      updatedCount += 1;
    }

    try {
      await saveTagRegistryMap();
      if (updatedCount) await saveMetadataMap();
      return toSerializable({ ok: true, deleted: text, updatedCount, tags: listTagDefinitions() });
    } catch (error) {
      tagRegistryIndex = previousRegistry;
      metadataIndex = previousMetadata;
      appendLog(`Failed to delete tag globally: ${error.message}`);
      return { ok: false, error: "Failed to delete tag" };
    }
  });

  ipcMain.handle("person:list", async () => toSerializable({ ok: true, people: listPersonDefinitions() }));

  ipcMain.handle("person:create", async (_, payload) => {
    const name = normalizePersonName(payload?.name ?? payload?.Name);
    const description = normalizePersonName(payload?.description ?? payload?.Description);
    if (!name) {
      return { ok: false, error: "Person name is required" };
    }
    if (personRegistryIndex.has(name)) {
      return { ok: false, error: "Person already exists" };
    }

    const now = new Date().toISOString();
    const person = { Name: name, Description: description, CreatedAt: now, UpdatedAt: now };
    personRegistryIndex.set(name, person);
    try {
      await savePersonRegistryMap();
      return toSerializable({ ok: true, person: { ...person, UsageCount: 0 }, people: listPersonDefinitions() });
    } catch (error) {
      personRegistryIndex.delete(name);
      appendLog(`Failed to create person: ${error.message}`);
      return { ok: false, error: "Failed to write person registry" };
    }
  });

  ipcMain.handle("person:update-description", async (_, payload) => {
    const name = normalizePersonName(payload?.name ?? payload?.Name);
    const description = normalizePersonName(payload?.description ?? payload?.Description);
    const current = personRegistryIndex.get(name);
    if (!name) {
      return { ok: false, error: "Person name is required" };
    }
    if (!current) {
      return { ok: false, error: "Person not found" };
    }

    const previous = { ...current };
    const next = { ...current, Description: description, UpdatedAt: new Date().toISOString() };
    personRegistryIndex.set(name, next);
    try {
      await savePersonRegistryMap();
      return toSerializable({ ok: true, person: { ...next, UsageCount: getPersonUsageCounts().get(name) || 0 }, people: listPersonDefinitions() });
    } catch (error) {
      personRegistryIndex.set(name, previous);
      appendLog(`Failed to update person description: ${error.message}`);
      return { ok: false, error: "Failed to write person registry" };
    }
  });

  ipcMain.handle("person:delete-global", async (_, payload) => {
    const name = normalizePersonName(payload?.name ?? payload?.Name);
    const current = personRegistryIndex.get(name);
    if (!name || !current) {
      return { ok: false, error: "Person not found" };
    }

    const previousRegistry = new Map(personRegistryIndex);
    const previousMetadata = new Map([...metadataIndex.entries()].map(([key, value]) => [key, structuredClone(value)]));
    let updatedCount = 0;
    personRegistryIndex.delete(name);

    for (const [filePath, item] of metadataIndex.entries()) {
      const people = Array.isArray(item?.Customization?.People) ? item.Customization.People : [];
      if (!people.includes(name)) continue;
      item.Customization = {
        ...(item.Customization || {}),
        People: people.filter((person) => person !== name),
        MetadataUpdateDate: new Date().toISOString(),
      };
      delete item.Customization.Category;
      metadataIndex.set(filePath, item);
      updatedCount += 1;
    }

    try {
      await savePersonRegistryMap();
      if (updatedCount) await saveMetadataMap();
      return toSerializable({ ok: true, deleted: name, updatedCount, people: listPersonDefinitions() });
    } catch (error) {
      personRegistryIndex = previousRegistry;
      metadataIndex = previousMetadata;
      appendLog(`Failed to delete person globally: ${error.message}`);
      return { ok: false, error: "Failed to delete person" };
    }
  });

  ipcMain.handle("location:list", async () => toSerializable({ ok: true, locations: listLocationDefinitions() }));

  ipcMain.handle("location:create", async (_, payload) => {
    const name = normalizeLocationName(payload?.name ?? payload?.Name);
    if (!name) {
      return { ok: false, error: "Location name is required" };
    }
    if (locationRegistryIndex.has(name)) {
      return { ok: false, error: "Location already exists" };
    }
    const parentValidation = validateLocationParent(name, payload?.parent ?? payload?.Parent);
    if (!parentValidation.ok) {
      return { ok: false, error: parentValidation.error };
    }

    const now = new Date().toISOString();
    const location = {
      Name: name,
      Country: normalizeLocationField(payload?.country ?? payload?.Country),
      Province: normalizeLocationField(payload?.province ?? payload?.Province),
      City: normalizeLocationField(payload?.city ?? payload?.City),
      Parent: parentValidation.parent,
      Description: normalizeLocationField(payload?.description ?? payload?.Description),
      CreatedAt: now,
      UpdatedAt: now,
    };
    locationRegistryIndex.set(name, location);
    try {
      await saveLocationRegistryMap();
      return toSerializable({ ok: true, location: { ...location, UsageCount: 0, Children: [], Depth: getLocationDepth(name), Path: buildLocationPath(name) }, locations: listLocationDefinitions() });
    } catch (error) {
      locationRegistryIndex.delete(name);
      appendLog(`Failed to create location: ${error.message}`);
      return { ok: false, error: "Failed to write location registry" };
    }
  });

  ipcMain.handle("location:update", async (_, payload) => {
    const name = normalizeLocationName(payload?.name ?? payload?.Name);
    const current = locationRegistryIndex.get(name);
    if (!name || !current) {
      return { ok: false, error: "Location not found" };
    }
    const parentValidation = validateLocationParent(name, payload?.parent ?? payload?.Parent);
    if (!parentValidation.ok) {
      return { ok: false, error: parentValidation.error };
    }

    const previous = { ...current };
    const next = {
      ...current,
      Country: normalizeLocationField(payload?.country ?? payload?.Country),
      Province: normalizeLocationField(payload?.province ?? payload?.Province),
      City: normalizeLocationField(payload?.city ?? payload?.City),
      Parent: parentValidation.parent,
      Description: normalizeLocationField(payload?.description ?? payload?.Description),
      UpdatedAt: new Date().toISOString(),
    };
    locationRegistryIndex.set(name, next);
    try {
      await saveLocationRegistryMap();
      return toSerializable({ ok: true, location: listLocationDefinitions().find((location) => location.Name === name), locations: listLocationDefinitions() });
    } catch (error) {
      locationRegistryIndex.set(name, previous);
      appendLog(`Failed to update location: ${error.message}`);
      return { ok: false, error: "Failed to write location registry" };
    }
  });

  ipcMain.handle("location:delete-global", async (_, payload) => {
    const name = normalizeLocationName(payload?.name ?? payload?.Name);
    const current = locationRegistryIndex.get(name);
    if (!name || !current) {
      return { ok: false, error: "Location not found" };
    }

    const previousRegistry = new Map(locationRegistryIndex);
    const previousMetadata = new Map([...metadataIndex.entries()].map(([key, value]) => [key, structuredClone(value)]));
    let updatedCount = 0;
    let orphanedChildren = 0;
    const now = new Date().toISOString();
    locationRegistryIndex.delete(name);

    for (const [childName, location] of locationRegistryIndex.entries()) {
      if (normalizeLocationName(location.Parent) !== name) continue;
      locationRegistryIndex.set(childName, { ...location, Parent: "", UpdatedAt: now });
      orphanedChildren += 1;
    }

    for (const [filePath, item] of metadataIndex.entries()) {
      if (normalizeLocationName(item?.Location?.Place ?? item?.Location?.Site) !== name) continue;
      item.Location = { Place: "", Detail: "" };
      item.Customization = {
        ...(item.Customization || {}),
        MetadataUpdateDate: now,
      };
      metadataIndex.set(filePath, item);
      updatedCount += 1;
    }

    try {
      await saveLocationRegistryMap();
      if (updatedCount) await saveMetadataMap();
      return toSerializable({ ok: true, deleted: name, updatedCount, orphanedChildren, locations: listLocationDefinitions() });
    } catch (error) {
      locationRegistryIndex = previousRegistry;
      metadataIndex = previousMetadata;
      appendLog(`Failed to delete location globally: ${error.message}`);
      return { ok: false, error: "Failed to delete location" };
    }
  });

  ipcMain.handle("album:list", async () => toSerializable({ ok: true, albums: listAlbumDefinitions() }));

  ipcMain.handle("album:create", async (_, payload) => {
    const title = normalizeAlbumTitle(payload?.title ?? payload?.Title);
    const description = normalizeAlbumTitle(payload?.description ?? payload?.Description);
    if (!title || !description) {
      return { ok: false, error: "Album title and description are required" };
    }
    if (albumRegistryIndex.has(title)) {
      return { ok: false, error: "Album already exists" };
    }

    const now = new Date().toISOString();
    const album = { Title: title, Description: description, CreatedAt: now, UpdatedAt: now };
    albumRegistryIndex.set(title, album);
    try {
      await saveAlbumRegistryMap();
      return toSerializable({ ok: true, album: { ...album, UsageCount: 0 }, albums: listAlbumDefinitions() });
    } catch (error) {
      albumRegistryIndex.delete(title);
      appendLog(`Failed to create album: ${error.message}`);
      return { ok: false, error: "Failed to write album registry" };
    }
  });

  ipcMain.handle("album:update-description", async (_, payload) => {
    const title = normalizeAlbumTitle(payload?.title ?? payload?.Title);
    const description = normalizeAlbumTitle(payload?.description ?? payload?.Description);
    const current = albumRegistryIndex.get(title);
    if (!title || !description) {
      return { ok: false, error: "Album title and description are required" };
    }
    if (!current) {
      return { ok: false, error: "Album not found" };
    }

    const previous = { ...current };
    const next = { ...current, Description: description, UpdatedAt: new Date().toISOString() };
    albumRegistryIndex.set(title, next);
    try {
      await saveAlbumRegistryMap();
      return toSerializable({ ok: true, album: { ...next, UsageCount: getAlbumUsageCounts().get(title) || 0 }, albums: listAlbumDefinitions() });
    } catch (error) {
      albumRegistryIndex.set(title, previous);
      appendLog(`Failed to update album description: ${error.message}`);
      return { ok: false, error: "Failed to write album registry" };
    }
  });

  ipcMain.handle("album:delete-global", async (_, payload) => {
    const title = normalizeAlbumTitle(payload?.title ?? payload?.Title);
    const current = albumRegistryIndex.get(title);
    if (!title || !current) {
      return { ok: false, error: "Album not found" };
    }

    const previousRegistry = new Map(albumRegistryIndex);
    const previousMetadata = new Map([...metadataIndex.entries()].map(([key, value]) => [key, structuredClone(value)]));
    let updatedCount = 0;
    albumRegistryIndex.delete(title);

    for (const [filePath, item] of metadataIndex.entries()) {
      if (normalizeAlbumTitle(item?.Customization?.Album) !== title) continue;
      item.Customization = {
        ...(item.Customization || {}),
        Album: "",
        MetadataUpdateDate: new Date().toISOString(),
      };
      delete item.Customization.Category;
      metadataIndex.set(filePath, item);
      updatedCount += 1;
    }

    try {
      await saveAlbumRegistryMap();
      if (updatedCount) await saveMetadataMap();
      return toSerializable({ ok: true, deleted: title, updatedCount, albums: listAlbumDefinitions() });
    } catch (error) {
      albumRegistryIndex = previousRegistry;
      metadataIndex = previousMetadata;
      appendLog(`Failed to delete album globally: ${error.message}`);
      return { ok: false, error: "Failed to delete album" };
    }
  });

  ipcMain.handle("photo:update-customization", async (_, payload) => {
    const { filePath, customization, location } = payload;
    const current = metadataIndex.get(filePath);

    if (!current) {
      return { ok: false, error: "Metadata item not found" };
    }

    if (Object.prototype.hasOwnProperty.call(customization || {}, "Tags")) {
      const validation = normalizeRegisteredTags(customization.Tags);
      if (validation.unknown.length) {
        return { ok: false, error: `Unknown tag: ${validation.unknown.join(", ")}` };
      }
      customization.Tags = validation.tags;
    }

    if (Object.prototype.hasOwnProperty.call(customization || {}, "Album")) {
      const validation = normalizeRegisteredAlbum(customization.Album);
      if (validation.unknown.length) {
        return { ok: false, error: `Unknown album: ${validation.unknown.join(", ")}` };
      }
      customization.Album = validation.album;
    }

    if (Object.prototype.hasOwnProperty.call(customization || {}, "People")) {
      const validation = normalizeRegisteredPeople(customization.People);
      if (validation.unknown.length) {
        return { ok: false, error: `Unknown person: ${validation.unknown.join(", ")}` };
      }
      customization.People = validation.people;
    }

    let normalizedLocation = null;
    if (location && typeof location === "object") {
      const validation = normalizeRegisteredLocation(location);
      if (validation.unknown.length) {
        return { ok: false, error: `Unknown location: ${validation.unknown.join(", ")}` };
      }
      normalizedLocation = validation.location;
    }

    // Merge user edits and stamp update time.
    current.Customization = {
      ...current.Customization,
      ...customization,
      MetadataUpdateDate: new Date().toISOString(),
    };
    delete current.Customization.Category;
    if (normalizedLocation) {
      current.Location = normalizedLocation;
    }

    metadataIndex.set(filePath, current);

    try {
      await saveMetadataMap();
      return toSerializable({ ok: true, item: enrichItem(current) });
    } catch (error) {
      appendLog(`Failed to write metadata: ${error.message}`);
      return { ok: false, error: "Failed to write metadata" };
    }
  });

  ipcMain.handle("photo:batch-update", async (_, payload) => {
    const filePaths = Array.isArray(payload?.filePaths) ? payload.filePaths : [];
    const addTags = Array.isArray(payload?.addTags) ? payload.addTags : [];
    const addPeople = Array.isArray(payload?.addPeople) ? payload.addPeople : [];
    const locationPatch = payload?.locationPatch && typeof payload.locationPatch === "object" ? payload.locationPatch : {};
    const customizationPatch = payload?.customizationPatch && typeof payload.customizationPatch === "object" ? payload.customizationPatch : {};

    if (!filePaths.length) {
      return { ok: false, error: "No target file paths" };
    }

    const dedupTags = [...new Set(addTags.map((x) => String(x || "").trim()).filter(Boolean))];
    const validation = normalizeRegisteredTags(dedupTags);
    if (validation.unknown.length) {
      return { ok: false, error: `Unknown tag: ${validation.unknown.join(", ")}` };
    }
    const dedupPeople = [...new Set(addPeople.map((x) => String(x || "").trim()).filter(Boolean))];
    const peopleValidation = normalizeRegisteredPeople(dedupPeople);
    if (peopleValidation.unknown.length) {
      return { ok: false, error: `Unknown person: ${peopleValidation.unknown.join(", ")}` };
    }
    if (Object.prototype.hasOwnProperty.call(customizationPatch, "Album")) {
      const albumValidation = normalizeRegisteredAlbum(customizationPatch.Album);
      if (albumValidation.unknown.length) {
        return { ok: false, error: `Unknown album: ${albumValidation.unknown.join(", ")}` };
      }
      customizationPatch.Album = albumValidation.album;
    }
    let normalizedLocationPatch = null;
    if (Object.prototype.hasOwnProperty.call(locationPatch, "Place")) {
      const locationValidation = normalizeRegisteredLocation({ Place: locationPatch.Place, Detail: "" });
      if (locationValidation.unknown.length) {
        return { ok: false, error: `Unknown location: ${locationValidation.unknown.join(", ")}` };
      }
      normalizedLocationPatch = locationValidation.location;
    }
    const updatedItems = [];
    const requestedCount = filePaths.length;
    let missingCount = 0;

    for (const filePath of filePaths) {
      const current = metadataIndex.get(filePath);
      if (!current) {
        missingCount += 1;
        continue;
      }

      const currentTags = Array.isArray(current?.Customization?.Tags) ? current.Customization.Tags : [];
      const mergedTags = [...currentTags];
      for (const tag of validation.tags) {
        if (!mergedTags.includes(tag)) mergedTags.push(tag);
      }

      const currentPeople = Array.isArray(current?.Customization?.People) ? current.Customization.People : [];
      const mergedPeople = [...currentPeople];
      for (const person of peopleValidation.people) {
        if (!mergedPeople.includes(person)) mergedPeople.push(person);
      }

      current.Customization = {
        ...current.Customization,
        ...customizationPatch,
        Tags: mergedTags,
        People: mergedPeople,
        MetadataUpdateDate: new Date().toISOString(),
      };
      delete current.Customization.Category;

      current.Location = normalizeLocationObject(current.Location);
      if (normalizedLocationPatch) {
        current.Location.Place = normalizedLocationPatch.Place;
      }

      metadataIndex.set(filePath, current);
      updatedItems.push(enrichItem(current));
    }

    try {
      if (updatedItems.length) await saveMetadataMap();
      return toSerializable({
        ok: true,
        requestedCount,
        updatedCount: updatedItems.length,
        missingCount,
        items: updatedItems,
      });
    } catch (error) {
      appendLog(`Failed to batch-write metadata: ${error.message}`);
      return { ok: false, error: "Failed to write metadata" };
    }
  });

  ipcMain.handle("photo:copy-path", async (_, absolutePath) => {
    clipboard.writeText(absolutePath);
    return { ok: true };
  });

  ipcMain.handle("photo:copy-json", async (_, item) => {
    clipboard.writeText(JSON.stringify(item, null, 2));
    return { ok: true };
  });

  ipcMain.handle("photo:copy-image", async (_, absolutePath) => {
    const image = nativeImage.createFromPath(absolutePath);
    if (image.isEmpty()) {
      return { ok: false, error: "Image load failed" };
    }
    clipboard.writeImage(image);
    return { ok: true };
  });

  ipcMain.handle("window:action", async (_, action) => {
    if (!mainWindow) return;
    if (action === "minimize") mainWindow.minimize();
    if (action === "maximize") mainWindow.maximize();
    if (action === "restore") mainWindow.unmaximize();
    if (action === "close") mainWindow.close();
  });

  ipcMain.handle("window:get-state", async () => ({
    isMaximized: Boolean(mainWindow?.isMaximized()),
  }));
}

/**
 * App bootstrap sequence:
 * 1) load config
 * 2) load metadata index
 * 3) create BrowserWindow
 * 4) bind renderer diagnostics hooks
 * 5) load renderer entry HTML
 */
async function bootstrap() {
  ensureConfig();
  await ensureDataDirectory();
  await loadMetadataIndex();
  await loadTagRegistryIndex();
  await loadAlbumRegistryIndex();
  await loadPersonRegistryIndex();
  await loadLocationRegistryIndex();
  // Start thumbnail warmup as soon as metadata is ready.
  warmupThumbnailCache().catch((error) => appendLog(`thumbnail-warmup failed: ${error.message}`));

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep sandbox disabled for this local desktop app setup to ensure
      // preload bridge works consistently in current environment.
      sandbox: false,
    },
  });

  // Renderer diagnostics: helps investigate blank-screen and startup issues quickly.
  mainWindow.webContents.on("did-fail-load", (_, errorCode, errorDescription, validatedURL) => {
    const msg = `did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedURL}`;
    console.error(msg);
    appendLog(msg);
  });

  mainWindow.webContents.on("render-process-gone", (_, details) => {
    const msg = `render-process-gone reason=${details?.reason} exitCode=${details?.exitCode}`;
    console.error(msg);
    appendLog(msg);
  });

  mainWindow.webContents.on("unresponsive", () => {
    const msg = "renderer became unresponsive";
    console.error(msg);
    appendLog(msg);
  });

  mainWindow.webContents.on("console-message", (_, level, message, line, sourceId) => {
    const msg = `renderer-console [${level}] ${message} @ ${sourceId}:${line}`;
    console.log(msg);
    appendLog(msg);
  });

  const emitWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("window:state-changed", {
      isMaximized: mainWindow.isMaximized(),
    });
  };
  mainWindow.on("maximize", emitWindowState);
  mainWindow.on("unmaximize", emitWindowState);
  mainWindow.on("enter-full-screen", emitWindowState);
  mainWindow.on("leave-full-screen", emitWindowState);

  if (fs.existsSync(RENDERER_INDEX_PATH)) {
    await mainWindow.loadFile(RENDERER_INDEX_PATH);
  } else {
    const message = "Renderer bundle not found. Run `npm run build:renderer` first.";
    appendLog(message);
    await mainWindow.loadURL(
      `data:text/html;charset=UTF-8,${encodeURIComponent(
        `<h2 style="font-family:Segoe UI, Arial, sans-serif; padding: 20px;">${message}</h2>`,
      )}`,
    );
  }
  emitWindowState();
}

// Standard Electron lifecycle.
app.whenReady().then(async () => {
  registerIpcHandlers();
  await bootstrap();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await bootstrap();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
