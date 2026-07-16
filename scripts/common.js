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
const sharp = require("sharp");
const {
  DATA_FILE_NAMES,
  MANAGER_DIR_NAME,
  readJsonlStrict,
  writeJsonlAtomic,
} = require("./library-core");
const {
  DEFAULT_MEDIA_CONFIG,
  normalizeMediaConfig,
  probeVideoFile,
  failedVideoMetadata,
} = require("./media-tools");
const {
  assertUuidV4,
  createEntityId,
} = require("../src/shared/identity-schema.js");

const APP_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CONFIG = {
  thumbnail: {
    size: 320,
    webpQuality: 80,
    extremeAspectRatio: 4,
    maxConcurrency: 4,
  },
  media: { ...DEFAULT_MEDIA_CONFIG },
  backup: { retentionCount: 10 },
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
    return {
      ...DEFAULT_CONFIG,
      thumbnail: { ...DEFAULT_CONFIG.thumbnail, ...(parsed?.thumbnail || {}) },
      media: normalizeMediaConfig(parsed?.media),
      backup: {
        retentionCount: Math.max(1, Math.trunc(Number(parsed?.backup?.retentionCount) || DEFAULT_CONFIG.backup.retentionCount)),
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// DFS traversal over one selected library directory tree.
/**
 * Traverse a library directory and collect all ordinary file paths.
 * The result is used by init/update/verify metadata workflows.
 */
async function walkFiles(root, options = {}) {
  const output = [];
  const resolvedRoot = path.resolve(root);
  const stack = [resolvedRoot];
  let visitedDirectories = 0;

  while (stack.length) {
    if (options.isCancelled?.()) {
      const error = new Error("Operation cancelled");
      error.code = "OPERATION_CANCELLED";
      throw error;
    }
    const current = stack.pop();
    const entries = await fsp.readdir(current, { withFileTypes: true });
    visitedDirectories += 1;
    options.onProgress?.({ phase: "scan", visitedDirectories, current });

    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (e.name === MANAGER_DIR_NAME) {
          if (path.resolve(current) === resolvedRoot) continue;
          const error = new Error(`Nested PhotoManager library detected: ${full}`);
          error.code = "NESTED_LIBRARY";
          throw error;
        }
        stack.push(full);
      }
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
function defaultCustomization(ext, type = extensionType(ext)) {
  const isJpg = ext.toLowerCase() === ".jpg" || ext.toLowerCase() === ".jpeg";
  return {
    Title: "",
    AlbumId: null,
    TagIds: [],
    PersonIds: [],
    Description: "",
    HiddenDescription: "",
    Rating: type === "video" || isJpg ? 2 : 1,
    Privacy: 1,
    MetadataUpdateDate: null,
  };
}

/**
 * Build default Location block for user-maintained location fields.
 * The registry reference is empty until the user assigns a location.
 */
function defaultLocation() {
  return {
    LocationId: null,
    Detail: "",
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

function decimalToDms(value) {
  const absolute = Math.abs(Number(value));
  if (!Number.isFinite(absolute)) return null;
  const degrees = Math.floor(absolute);
  const minutesRaw = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesRaw);
  const seconds = Number(((minutesRaw - minutes) * 60).toFixed(6));
  return [degrees, minutes, seconds];
}

/** Normalize EXIF Flash to whether the flash actually fired. */
function normalizeFlashUsed(value) {
  if (value === null || value === undefined || value === "") return null;
  if (ArrayBuffer.isView(value)) return value.length === 1 ? normalizeFlashUsed(value[0]) : null;
  if (Array.isArray(value)) return value.length === 1 ? normalizeFlashUsed(value[0]) : null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Boolean(Math.trunc(value) & 1) : null;
  }
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Boolean(Number(text) & 1);
  if (text.includes("did not fire") || text.includes("not fired")) return false;
  if (text.includes("flash fired") || text === "fired") return true;
  return null;
}

/** Store a channel bit depth only when it can be represented by one integer. */
function normalizePictureBitDepth(value) {
  if (value === null || value === undefined || value === "") return null;
  const values = ArrayBuffer.isView(value) || Array.isArray(value) ? [...value] : [value];
  if (!values.length) return null;
  const normalized = values.map((item) => Number(item));
  if (normalized.some((item) => !Number.isInteger(item) || item <= 0)) return null;
  return normalized.every((item) => item === normalized[0]) ? normalized[0] : null;
}

function normalizePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseMediaDate(value) {
  if (!value) return null;
  const raw = String(value).trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function inspectMediaFile(filePath, workspaceRoot) {
  const ext = path.extname(filePath);
  const type = extensionType(ext);
  if (!type) return null;
  const stat = await fsp.stat(filePath);
  return {
    filePath,
    relativePath: path.relative(workspaceRoot, filePath).replace(/\\/g, "/"),
    ext,
    type,
    stat,
    creation: timeInfoFromDate(stat.birthtime),
    modified: timeInfoFromDate(stat.mtime),
  };
}

/**
 * Build one metadata record from an on-disk file.
 * Reads filesystem stats, hash, and EXIF fields (for images).
 */
async function buildMetadata(filePath, workspaceRoot, options = {}) {
  const snapshot = options.snapshot || await inspectMediaFile(filePath, workspaceRoot);
  if (!snapshot) return null;
  const { ext, type, stat, creation, modified, relativePath } = snapshot;
  const hash = options.hash || await sha256File(filePath);

  let exif = null;
  let width = 0;
  let height = 0;
  let dpi = null;
  let bitDepth = null;
  let pictureProbeStatus = "ok";
  let pictureProbeError = null;

  let videoProbe = null;
  if (type === "image") {
    try {
      const imageMetadata = await sharp(filePath, { failOn: "error" }).metadata();
      width = imageMetadata.width || 0;
      height = imageMetadata.height || 0;
      dpi = imageMetadata.density || null;
    } catch (error) {
      pictureProbeStatus = "failed";
      pictureProbeError = String(error?.message || "Image decode failed")
        .replaceAll(filePath, "<media>")
        .replace(/[\r\n]+/g, " ")
        .slice(0, 500);
    }
    try {
      exif = await exifr.parse(filePath, { translateValues: false });
    } catch {
      exif = null;
    }
  } else {
    try {
      videoProbe = await probeVideoFile(filePath, APP_ROOT, options.mediaConfig || DEFAULT_MEDIA_CONFIG);
    } catch (error) {
      videoProbe = {
        video: failedVideoMetadata(error, filePath),
        creationTime: null,
        camera: { make: null, model: null },
        location: null,
      };
    }
  }

  if (exif) {
    width ||= exif.ExifImageWidth || exif.ImageWidth || 0;
    height ||= exif.ExifImageHeight || exif.ImageHeight || 0;
    dpi ||= exif.XResolution || null;
    bitDepth = exif.BitsPerSample || null;
  }

  const videoShootingDate = parseMediaDate(videoProbe?.creationTime);
  const shooting = type === "video"
    ? (videoShootingDate ? timeInfoFromDate(videoShootingDate) : modified)
    : (exif?.DateTimeOriginal ? timeInfoFromDate(exif.DateTimeOriginal) : creation);
  const videoLocation = videoProbe?.location || null;
  const output = {
    MediaId: createEntityId(),
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
      ModificationTimeMs: stat.mtimeMs,
    },
    GPS: {
      LatitudeRef: type === "video" && videoLocation ? (videoLocation.latitude < 0 ? "S" : "N") : exif?.GPSLatitudeRef || null,
      Latitude: type === "video" && videoLocation ? decimalToDms(videoLocation.latitude) : dmsToArray(exif?.GPSLatitude),
      LongitudeRef: type === "video" && videoLocation ? (videoLocation.longitude < 0 ? "W" : "E") : exif?.GPSLongitudeRef || null,
      Longitude: type === "video" && videoLocation ? decimalToDms(videoLocation.longitude) : dmsToArray(exif?.GPSLongitude),
      AltitudeRef: type === "video" && videoLocation && videoLocation.altitude !== null ? (videoLocation.altitude < 0 ? 1 : 0) : exif?.GPSAltitudeRef ?? null,
      Altitude: type === "video" && videoLocation && videoLocation.altitude !== null
        ? [Math.round(Math.abs(videoLocation.altitude) * 100), 100]
        : exif?.GPSAltitude ? [Math.round(Number(exif.GPSAltitude) * 100), 100] : null,
    },
    Location: defaultLocation(),
    Camera: {
      Make: type === "video" ? videoProbe?.camera?.make || null : exif?.Make || null,
      Model: type === "video" ? videoProbe?.camera?.model || null : exif?.Model || null,
      FocalLength: exif?.FocalLength || null,
      Aperture: exif?.FNumber || null,
      ISO: exif?.ISO || null,
      ExposureTime: exif?.ExposureTime || null,
      FlashUsed: normalizeFlashUsed(exif?.Flash),
    },
    Customization: defaultCustomization(ext, type),
  };
  if (type === "image") {
    output.Picture = {
      ProbeStatus: pictureProbeStatus,
      ProbeError: pictureProbeError,
      Width: pictureProbeStatus === "ok" ? width || null : null,
      Height: pictureProbeStatus === "ok" ? height || null : null,
      Dpi: pictureProbeStatus === "ok" ? normalizePositiveNumber(dpi) : null,
      BitDepth: pictureProbeStatus === "ok" ? normalizePictureBitDepth(bitDepth) : null,
    };
  } else {
    output.Video = videoProbe.video;
  }
  return output;
}

/**
 * Read existing JSONL metadata file into a FilePath-keyed map.
 * JSONL identity is validated by MediaId before paths are indexed for scanning.
 */
async function loadExisting(metadataFile) {
  if (!fs.existsSync(metadataFile)) return new Map();
  const lines = await readJsonlStrict(metadataFile, {
    required: false,
    label: path.basename(metadataFile),
    keyOf: (item) => item?.MediaId,
  });
  const map = new Map();
  for (const item of lines) {
    assertUuidV4(item.MediaId, `MediaId for ${item?.FilePath || "metadata record"}`);
    if (typeof item.FilePath !== "string" || !item.FilePath.trim()) throw new Error("Metadata record is missing FilePath");
    if (map.has(item.FilePath)) throw new Error(`Metadata contains duplicate FilePath: ${item.FilePath}`);
    map.set(item.FilePath, item);
  }
  return map;
}

// Atomic rewrite helper for JSONL persistence.
/**
 * Atomically rewrite all metadata entries to JSONL.
 * Writes to a temporary file first, then renames to avoid partial writes.
 */
async function writeAll(metadataFile, entries) {
  await writeJsonlAtomic(metadataFile, entries);
}

module.exports = {
  APP_ROOT,
  DEFAULT_CONFIG,
  DATA_FILE_NAMES,
  resolveConfig,
  walkFiles,
  inspectMediaFile,
  sha256File,
  buildMetadata,
  loadExisting,
  writeAll,
  extensionType,
  timeInfoFromDate,
  parseMediaDate,
  defaultCustomization,
  normalizeFlashUsed,
  normalizePictureBitDepth,
  normalizePositiveNumber,
};
