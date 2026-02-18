/**
 * Export metadata JSONL into spreadsheet-friendly CSV.
 *
 * Column layout principle:
 * - High-priority user-facing fields (Customization / Location) stay on the left.
 * - Technical fields (filesystem / GPS / camera) stay on the right.
 */
const path = require("node:path");
const fsp = require("node:fs/promises");
const { resolveConfig, absFromConfig, loadExisting } = require("./common");

// Ordered flattened columns. Left side is intentionally user-facing.
const COLUMNS = [
  { header: "FilePath", get: (item) => item?.FilePath || "" },
  { header: "Title", get: (item) => item?.Customization?.Title || "" },
  { header: "Rating", get: (item) => item?.Customization?.Rating ?? "" },
  { header: "Album", get: (item) => item?.Customization?.Album || "" },
  { header: "Tags", get: (item) => (item?.Customization?.Tags || []).join(" | ") },
  { header: "Description", get: (item) => item?.Customization?.Description || "" },
  { header: "HiddenDescription", get: (item) => item?.Customization?.HiddenDescription || "" },
  { header: "Hidden", get: (item) => item?.Customization?.Hidden ?? false },
  { header: "MetadataUpdateDate", get: (item) => item?.Customization?.MetadataUpdateDate || "" },
  { header: "Location.Site", get: (item) => item?.Location?.Site || "" },
  { header: "Location.City", get: (item) => item?.Location?.City || "" },
  { header: "Location.Province", get: (item) => item?.Location?.Province || "" },
  { header: "Location.Country", get: (item) => item?.Location?.Country || "" },
  { header: "FileSystem.ShootingTimeString", get: (item) => item?.FileSystem?.ShootingTimeString || "" },
  { header: "FileSystem.ModificationTimeString", get: (item) => item?.FileSystem?.ModificationTimeString || "" },
  { header: "Picture.Width", get: (item) => item?.Picture?.Width ?? "" },
  { header: "Picture.Height", get: (item) => item?.Picture?.Height ?? "" },
  { header: "FileSystem.FileSize", get: (item) => item?.FileSystem?.FileSize ?? "" },
  { header: "FileSystem.FileType", get: (item) => item?.FileSystem?.FileType || "" },
  { header: "FileSystem.FileExtension", get: (item) => item?.FileSystem?.FileExtension || "" },
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
  const metadataFile = absFromConfig(config, config.metadataFile);
  const defaultOutput = metadataFile.replace(/\.jsonl$/i, ".csv");
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

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
