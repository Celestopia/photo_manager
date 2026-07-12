/**
 * Export metadata JSONL into spreadsheet-friendly CSV.
 *
 * Column layout principle:
 * - High-priority user-facing fields (Customization / Location) stay on the left.
 * - Technical fields (filesystem / GPS / camera) stay on the right.
 */
const path = require("node:path");
const fsp = require("node:fs/promises");
const { DATA_FILE_NAMES, resolveConfig, dataFilePath, ensureDataDir, loadExisting } = require("./common");

// Ordered flattened columns. Left side is intentionally user-facing.
const COLUMNS = [
  { header: "FilePath", get: (item) => item?.FilePath || "" },
  { header: "Title", get: (item) => item?.Customization?.Title || "" },
  { header: "Rating", get: (item) => item?.Customization?.Rating ?? "" },
  { header: "Album", get: (item) => item?.Customization?.Album || "" },
  { header: "Tags", get: (item) => (item?.Customization?.Tags || []).join(" | ") },
  { header: "People", get: (item) => (item?.Customization?.People || []).join(" | ") },
  { header: "Description", get: (item) => item?.Customization?.Description || "" },
  { header: "HiddenDescription", get: (item) => item?.Customization?.HiddenDescription || "" },
  { header: "Hidden", get: (item) => item?.Customization?.Hidden ?? false },
  { header: "MetadataUpdateDate", get: (item) => item?.Customization?.MetadataUpdateDate || "" },
  { header: "Location.Place", get: (item) => item?.Location?.Place || item?.Location?.Site || "" },
  { header: "Location.Detail", get: (item) => item?.Location?.Detail || "" },
  { header: "FileSystem.FileType", get: (item) => item?.FileSystem?.FileType || "" },
  { header: "FileSystem.ShootingTimeString", get: (item) => item?.FileSystem?.ShootingTimeString || "" },
  { header: "FileSystem.ModificationTimeString", get: (item) => item?.FileSystem?.ModificationTimeString || "" },
  { header: "Picture.Width", get: (item) => item?.Picture?.Width ?? "" },
  { header: "Picture.Height", get: (item) => item?.Picture?.Height ?? "" },
  { header: "Video.ProbeStatus", get: (item) => item?.Video?.ProbeStatus || "" },
  { header: "Video.ProbeError", get: (item) => item?.Video?.ProbeError || "" },
  { header: "Video.DurationSeconds", get: (item) => item?.Video?.DurationSeconds ?? "" },
  { header: "Video.Width", get: (item) => item?.Video?.Width ?? "" },
  { header: "Video.Height", get: (item) => item?.Video?.Height ?? "" },
  { header: "Video.DisplayWidth", get: (item) => item?.Video?.DisplayWidth ?? "" },
  { header: "Video.DisplayHeight", get: (item) => item?.Video?.DisplayHeight ?? "" },
  { header: "Video.RotationDegrees", get: (item) => item?.Video?.RotationDegrees ?? "" },
  { header: "Video.SampleAspectRatio", get: (item) => item?.Video?.SampleAspectRatio || "" },
  { header: "Video.FrameRate", get: (item) => item?.Video?.FrameRate ?? "" },
  { header: "Video.FrameRateRatio", get: (item) => item?.Video?.FrameRateRatio || "" },
  { header: "Video.VideoCodec", get: (item) => item?.Video?.VideoCodec || "" },
  { header: "Video.VideoProfile", get: (item) => item?.Video?.VideoProfile || "" },
  { header: "Video.PixelFormat", get: (item) => item?.Video?.PixelFormat || "" },
  { header: "Video.BitDepth", get: (item) => item?.Video?.BitDepth ?? "" },
  { header: "Video.BitRate", get: (item) => item?.Video?.BitRate ?? "" },
  { header: "Video.ContainerFormat", get: (item) => item?.Video?.ContainerFormat || "" },
  { header: "Video.VideoStreamCount", get: (item) => item?.Video?.VideoStreamCount ?? "" },
  { header: "Video.AudioStreamCount", get: (item) => item?.Video?.AudioStreamCount ?? "" },
  { header: "Video.HasAudio", get: (item) => item?.Video?.HasAudio ?? "" },
  { header: "Video.AudioCodec", get: (item) => item?.Video?.AudioCodec || "" },
  { header: "Video.AudioChannels", get: (item) => item?.Video?.AudioChannels ?? "" },
  { header: "Video.AudioSampleRate", get: (item) => item?.Video?.AudioSampleRate ?? "" },
  { header: "Video.AudioBitRate", get: (item) => item?.Video?.AudioBitRate ?? "" },
  { header: "Video.ColorSpace", get: (item) => item?.Video?.ColorSpace || "" },
  { header: "Video.ColorTransfer", get: (item) => item?.Video?.ColorTransfer || "" },
  { header: "Video.ColorPrimaries", get: (item) => item?.Video?.ColorPrimaries || "" },
  { header: "FileSystem.FileSize", get: (item) => item?.FileSystem?.FileSize ?? "" },
  { header: "FileSystem.FileExtension", get: (item) => item?.FileSystem?.FileExtension || "" },
  { header: "FileSystem.ModificationTimeMs", get: (item) => item?.FileSystem?.ModificationTimeMs ?? "" },
  { header: "SHA256Hash", get: (item) => item?.SHA256Hash || "" },
  { header: "GPS.LatitudeRef", get: (item) => item?.GPS?.LatitudeRef || "" },
  { header: "GPS.Latitude", get: (item) => formatValue(item?.GPS?.Latitude) },
  { header: "GPS.LongitudeRef", get: (item) => item?.GPS?.LongitudeRef || "" },
  { header: "GPS.Longitude", get: (item) => formatValue(item?.GPS?.Longitude) },
  { header: "GPS.AltitudeRef", get: (item) => formatValue(item?.GPS?.AltitudeRef) },
  { header: "GPS.Altitude", get: (item) => formatValue(item?.GPS?.Altitude) },
  { header: "Camera.Make", get: (item) => item?.Camera?.Make || "" },
  { header: "Camera.Model", get: (item) => item?.Camera?.Model || "" },
  { header: "Camera.FocalLength", get: (item) => item?.Camera?.FocalLength ?? "" },
  { header: "Camera.Aperture", get: (item) => item?.Camera?.Aperture ?? "" },
  { header: "Camera.ISO", get: (item) => item?.Camera?.ISO ?? "" },
  { header: "Camera.ExposureTime", get: (item) => item?.Camera?.ExposureTime ?? "" },
  { header: "Camera.FlashUsed", get: (item) => item?.Camera?.FlashUsed ?? false },
];

/**

 * Normalize complex values (arrays/objects/null) into CSV-safe text tokens.

 * Used by column extractors before final CSV cell escaping.

 */

function formatValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

/**

 * Escape CSV-special characters according to RFC-style quoting rules.

 * Ensures commas, quotes, and new lines do not break column structure.

 */

function toCell(value) {
  const text = String(formatValue(value));
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
  return text;
}

/**

 * Load JSONL metadata, flatten selected fields, and write spreadsheet-friendly CSV.

 * Column order prioritizes user-facing fields on the left side.

 */

async function run() {
  const config = resolveConfig();
  await ensureDataDir(config);
  const metadataFile = dataFilePath(config, DATA_FILE_NAMES.metadata);
  const defaultOutput = dataFilePath(config, "photo_metadata.csv");
  const outputFile = process.argv[2]
    ? (path.isAbsolute(process.argv[2]) ? process.argv[2] : path.resolve(process.cwd(), process.argv[2]))
    : defaultOutput;

  const map = await loadExisting(metadataFile);
  const items = [...map.values()];

  const lines = [];
  lines.push(COLUMNS.map((column) => toCell(column.header)).join(","));
  for (const item of items) {
    lines.push(COLUMNS.map((column) => toCell(column.get(item))).join(","));
  }

  // Prefix BOM for better UTF-8 compatibility in spreadsheet apps on Windows.
  const csvText = `\uFEFF${lines.join("\r\n")}\r\n`;
  await fsp.writeFile(outputFile, csvText, "utf8");
  console.log(`Exported ${items.length} rows to ${outputFile}`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { COLUMNS, formatValue, toCell, run };
