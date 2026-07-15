/**
 * Export metadata JSONL into spreadsheet-friendly CSV.
 *
 * Column layout principle:
 * - High-priority user-facing fields (Customization / Location) stay on the left.
 * - Technical fields (filesystem / GPS / camera) stay on the right.
 */
const path = require("node:path");
const { loadExisting } = require("./common");
const { parseLibraryArgument, writeTextAtomic } = require("./library-core");
const { validateExistingLibrary, authorizeLibraryOperation, validateMetadataPaths } = require("./library-access");
const { createOperationReporter } = require("./operation-progress");
const { readTransactionJournal } = require("./library-transaction");
const { assertCustomization } = require("../src/shared/customization-schema");
const { loadRegistryIndexes, validateMetadataMap } = require("./library-data.js");

// Ordered flattened columns. Left side is intentionally user-facing.
const COLUMNS = [
  { header: "MediaId", get: (item) => item?.MediaId || "" },
  { header: "FilePath", get: (item) => item?.FilePath || "" },
  { header: "Title", get: (item) => item?.Customization?.Title || "" },
  { header: "Rating", get: (item) => item?.Customization?.Rating ?? "" },
  { header: "Privacy", get: (item) => item?.Customization?.Privacy ?? "" },
  { header: "AlbumId", get: (item) => item?.Customization?.AlbumId || "" },
  { header: "Album", get: (item, context) => context.albums.get(item?.Customization?.AlbumId)?.Title || "" },
  { header: "TagIds", get: (item) => (item?.Customization?.TagIds || []).join(" | ") },
  { header: "Tags", get: (item, context) => (item?.Customization?.TagIds || []).map((id) => context.tags.get(id)?.Text).join(" | ") },
  { header: "PersonIds", get: (item) => (item?.Customization?.PersonIds || []).join(" | ") },
  { header: "People", get: (item, context) => (item?.Customization?.PersonIds || []).map((id) => context.people.get(id)?.Name).join(" | ") },
  { header: "Description", get: (item) => item?.Customization?.Description || "" },
  { header: "HiddenDescription", get: (item) => item?.Customization?.HiddenDescription || "" },
  { header: "MetadataUpdateDate", get: (item) => item?.Customization?.MetadataUpdateDate || "" },
  { header: "LocationId", get: (item) => item?.Location?.LocationId || "" },
  { header: "Location.Name", get: (item, context) => context.locations.get(item?.Location?.LocationId)?.Name || "" },
  { header: "Location.Detail", get: (item) => item?.Location?.Detail || "" },
  { header: "FileSystem.FileType", get: (item) => item?.FileSystem?.FileType || "" },
  { header: "FileSystem.ShootingTimeString", get: (item) => item?.FileSystem?.ShootingTimeString || "" },
  { header: "FileSystem.ModificationTimeString", get: (item) => item?.FileSystem?.ModificationTimeString || "" },
  { header: "Picture.ProbeStatus", get: (item) => item?.Picture?.ProbeStatus || "" },
  { header: "Picture.ProbeError", get: (item) => item?.Picture?.ProbeError || "" },
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

async function run(options = {}) {
  const paths = options.paths || parseLibraryArgument();
  const { emit, warnings, errors } = createOperationReporter({ ...options, logger: options.logger || console });
  const manifest = await validateExistingLibrary(paths, { onProgress: (progress) => emit(progress) });
  const authorization = await authorizeLibraryOperation(paths, manifest, options);
  const outputIndex = process.argv.indexOf("--output");
  const rawOutput = options.outputFile || (outputIndex >= 0 ? process.argv[outputIndex + 1] : "");
  const outputFile = rawOutput
    ? (path.isAbsolute(rawOutput) ? rawOutput : path.resolve(process.cwd(), rawOutput))
    : path.join(paths.dataDir, "photo_metadata.csv");

  try {
  if (await readTransactionJournal(paths)) throw new Error("A pending library transaction must be recovered by opening the library before export");
  const map = await loadExisting(paths.metadataFile);
  const registryIndexes = await loadRegistryIndexes(paths);
  validateMetadataMap(map, registryIndexes);
  validateMetadataPaths(paths, map.values());
  const items = [...map.values()];
  for (const item of items) assertCustomization(item.Customization, item.FilePath);
  const columnContext = {
    tags: registryIndexes.tags.byId,
    albums: registryIndexes.albums.byId,
    people: registryIndexes.people.byId,
    locations: registryIndexes.locations.byId,
  };

  const lines = [];
  lines.push(COLUMNS.map((column) => toCell(column.header)).join(","));
  for (const item of items) {
    lines.push(COLUMNS.map((column) => toCell(column.get(item, columnContext))).join(","));
  }

  // Prefix BOM for better UTF-8 compatibility in spreadsheet apps on Windows.
  const csvText = `\uFEFF${lines.join("\r\n")}\r\n`;
  await writeTextAtomic(outputFile, csvText);
  emit({ phase: "complete", processed: items.length, total: items.length, message: "CSV 导出完成" });
  return { rows: items.length, outputFile, warnings, errors };
  } finally {
    await authorization.release();
  }
}

if (require.main === module) {
  run({ logger: console }).then((result) => {
    console.log(`Exported ${result.rows} rows to ${result.outputFile}`);
  }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { COLUMNS, formatValue, toCell, run };
