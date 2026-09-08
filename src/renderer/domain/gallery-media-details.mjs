import { formatDuration, formatFileSize } from "./media-formatters.mjs";

function displayValue(value) {
  const text = String(value ?? "").trim();
  return text || "-";
}

export function getMediaFilename(item) {
  const path = String(item?.FilePath || "");
  return displayValue(path.split(/[\\/]/).pop());
}

export function formatMediaResolution(item) {
  const isVideo = item?.FileSystem?.FileType === "video";
  const width = Number(isVideo ? item?.Video?.DisplayWidth : item?.Picture?.Width);
  const height = Number(isVideo ? item?.Video?.DisplayHeight : item?.Picture?.Height);
  return width > 0 && height > 0 ? `${width}x${height}` : "-";
}

export function formatVideoFrameRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "-";
  return `${Number(numeric.toFixed(3))} fps`;
}

/** Build the fixed, read-only field sequence used by the gallery details popover. */
export function buildGalleryMediaDetailRows(item, resolvers = {}) {
  const rows = [
    { key: "filename", label: "File name", value: getMediaFilename(item) },
    { key: "shooting-date", label: "Date taken", value: displayValue(item?.FileSystem?.ShootingTimeString) },
    { key: "modification-date", label: "Date modified", value: displayValue(item?.FileSystem?.ModificationTimeString) },
    { key: "file-size", label: "File size", value: formatFileSize(item?.FileSystem?.FileSize) },
    { key: "resolution", label: "Resolution", value: formatMediaResolution(item) },
  ];

  if (item?.FileSystem?.FileType === "video") {
    rows.push(
      { key: "frame-rate", label: "Frame rate", value: formatVideoFrameRate(item?.Video?.FrameRate) },
      { key: "duration", label: "Duration", value: formatDuration(item?.Video?.DurationSeconds) },
    );
  }

  const tags = Array.isArray(item?.Customization?.TagIds)
    ? item.Customization.TagIds.map((id) => resolvers.getTagText?.(id) || "").filter(Boolean).join(", ")
    : "";
  rows.push(
    { key: "location", label: "Location", value: displayValue(resolvers.getLocationName?.(item?.Location?.LocationId)) },
    { key: "tags", label: "Tags", value: displayValue(tags) },
  );
  return rows;
}
