/**
 * Shared utilities for metadata maintenance scripts.
 *
 * These functions are reused by:
 * - init-metadata.js
 * - update-metadata.js
 * - verify-metadata.js
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const yaml = require("js-yaml");
const exifr = require("exifr");

const APP_ROOT = path.resolve(__dirname, "..");

const DEFAULT_CONFIG = {
  workspaceRoot: "./photo_workspace",
  metadataFile: "./photo_metadata.jsonl",
  tagRegistryFile: "./tag_registry.jsonl",
  albumRegistryFile: "./album_registry.jsonl",
  personRegistryFile: "./person_registry.jsonl",
  logDir: "./logs",
  thumbnail: {
    dir: "./thumb_cache",
    size: 320,
    webpQuality: 80,
    extremeAspectRatio: 4,
    maxConcurrency: 4,
  },
};

// Load config.yml and guarantee required defaults.
/**
 * Load config.yml and merge with defaults required by metadata scripts.
 * If config is missing or invalid, defaults are returned to keep scripts runnable.
 */
function resolveConfig() {
  const configPath = path.join(APP_ROOT, "config.yml");
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, yaml.dump(DEFAULT_CONFIG), "utf8");
    return { ...DEFAULT_CONFIG };
  }

  try {
    const parsed = yaml.load(fs.readFileSync(configPath, "utf8"));
    return { ...DEFAULT_CONFIG, ...(parsed || {}) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// Resolve project-relative path from config into absolute path.
/**
 * Resolve a config path to absolute filesystem path.
 * Supports both already-absolute and project-relative inputs.
 */
function absFromConfig(config, p) {
  return path.isAbsolute(p) ? p : path.resolve(APP_ROOT, p);
}

// DFS traversal over workspace directory tree.
/**
 * Traverse workspace directories and collect all file paths.
 * The result is used by init/update/verify metadata workflows.
 */
async function walkFiles(root) {
  const output = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    const entries = await fsp.readdir(current, { withFileTypes: true });

    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) output.push(full);
    }
  }

  return output;
}

// Streaming SHA256 hash to avoid loading whole file into memory.
/**
 * Compute SHA256 hash using streaming reads.
 * Streaming avoids loading large files fully into memory.
 */
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

// File-type gate: only known image/video extensions are handled.
/**
 * Map file extension to logical media type (image/video).
 * Unsupported extensions return null so callers can skip them early.
 */
function extensionType(ext) {
  if ([".jpg", ".jpeg", ".png", ".bmp", ".webp", ".gif"].includes(ext.toLowerCase())) return "image";
  if ([".mp4", ".mov", ".mkv", ".avi"].includes(ext.toLowerCase())) return "video";
  return null;
}

// Normalize Date object into three stored fields used by metadata schema.
/**
 * Normalize Date into schema fields: formatted text, timezone, and unix timestamp.
 * Ensures consistent time representation across metadata records.
 */
function timeInfoFromDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const local = new Date(date);
  const tz = -local.getTimezoneOffset() / 60;
  return {
    text: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}`,
    zone: tz,
    stamp: Math.floor(local.getTime() / 1000),
  };
}

// Default user-editable metadata values.
/**
 * Build default Customization block for a new metadata record.
 * Rating defaults differ for camera photos (.jpg/.jpeg) versus screenshots.
 */
function defaultCustomization(ext) {
  const isJpg = ext.toLowerCase() === ".jpg" || ext.toLowerCase() === ".jpeg";
  return {
    Title: "",
    Album: "",
    Tags: [],
    People: [],
    Description: "",
    HiddenDescription: "",
    Rating: isJpg ? 2 : 1,
    Hidden: false,
    MetadataUpdateDate: null,
  };
}

// Default location metadata values (manually maintained by user).
/**
 * Build default Location block for user-maintained location fields.
 * All fields start as empty strings and are filled by manual edits.
 */
function defaultLocation() {
  return {
    Country: "",
    Province: "",
    City: "",
    Site: "",
  };
}

// Convert EXIF DMS tuple into number array representation used in schema.
/**
 * Convert EXIF DMS coordinate tuple to [degree, minute, second] array.
 * Returns null when source data is missing or malformed.
 */
function dmsToArray(dms) {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  return [Number(dms[0]), Number(dms[1]), Number(dms[2])];
}

/**
 * Build one metadata record from an on-disk file.
 * Reads filesystem stats, hash, and EXIF fields (for images).
 */
async function buildMetadata(filePath, workspaceRoot) {
  const ext = path.extname(filePath);
  const type = extensionType(ext);
  if (!type) return null;

  const stat = await fsp.stat(filePath);
  const creation = timeInfoFromDate(stat.birthtime);
  const modified = timeInfoFromDate(stat.mtime);
  const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
  const hash = await sha256File(filePath);

  let exif = null;
  let width = 0;
  let height = 0;
  let dpi = null;
  let bitDepth = null;

  if (type === "image") {
    try {
      exif = await exifr.parse(filePath, { translateValues: false });
    } catch {
      exif = null;
    }
  }

  if (exif) {
    width = exif.ExifImageWidth || exif.ImageWidth || 0;
    height = exif.ExifImageHeight || exif.ImageHeight || 0;
    dpi = exif.XResolution || null;
    bitDepth = exif.BitsPerSample || null;
  }

  const shooting = exif?.DateTimeOriginal ? timeInfoFromDate(exif.DateTimeOriginal) : creation;

  return {
    FilePath: relativePath,
    SHA256Hash: hash,
    FileSystem: {
      FileType: type,
      FileExtension: ext.replace(".", "").toLowerCase(),
      FileSize: stat.size,
      ShootingTimeString: shooting.text,
      ShootingTimeZone: shooting.zone,
      ShootingTimeStamp: shooting.stamp,
      CreationTimeString: creation.text,
      CreationTimeZone: creation.zone,
      CreationTimeStamp: creation.stamp,
      ModificationTimeString: modified.text,
      ModificationTimeZone: modified.zone,
      ModificationTimeStamp: modified.stamp,
    },
    Picture: {
      Width: width,
      Height: height,
      dpi,
      BitDepth: bitDepth,
    },
    GPS: {
      LatitudeRef: exif?.GPSLatitudeRef || null,
      Latitude: dmsToArray(exif?.GPSLatitude),
      LongitudeRef: exif?.GPSLongitudeRef || null,
      Longitude: dmsToArray(exif?.GPSLongitude),
      AltitudeRef: exif?.GPSAltitudeRef ?? null,
      Altitude: exif?.GPSAltitude ? [Math.round(Number(exif.GPSAltitude) * 100), 100] : null,
    },
    Location: defaultLocation(),
    Camera: {
      Make: exif?.Make || null,
      Model: exif?.Model || null,
      FocalLength: exif?.FocalLength || null,
      Aperture: exif?.FNumber || null,
      ISO: exif?.ISO || null,
      ExposureTime: exif?.ExposureTime || null,
      FlashUsed: Boolean(exif?.Flash),
    },
    Customization: defaultCustomization(ext),
  };
}

// Load existing JSONL file into FilePath-keyed Map.
/**
 * Read existing JSONL metadata file into a FilePath-keyed map.
 * Invalid JSON lines are ignored to keep maintenance scripts robust.
 */
async function loadExisting(metadataFile) {
  if (!fs.existsSync(metadataFile)) return new Map();
  const content = await fsp.readFile(metadataFile, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  const map = new Map();
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item?.FilePath) map.set(item.FilePath, item);
    } catch {
      // Ignore broken lines.
    }
  }
  return map;
}

// Atomic rewrite helper for JSONL persistence.
/**
 * Atomically rewrite all metadata entries to JSONL.
 * Writes to a temporary file first, then renames to avoid partial writes.
 */
async function writeAll(metadataFile, entries) {
  const temp = `${metadataFile}.tmp`;
  const lines = [...entries].map((x) => JSON.stringify(x));
  await fsp.writeFile(temp, `${lines.join("\n")}${lines.length ? "\n" : ""}`, "utf8");
  await fsp.rename(temp, metadataFile);
}

module.exports = { resolveConfig, absFromConfig, walkFiles, buildMetadata, loadExisting, writeAll, extensionType };
