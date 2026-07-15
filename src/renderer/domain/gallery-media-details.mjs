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
    { key: "filename", label: "文件名", value: getMediaFilename(item) },
    { key: "shooting-date", label: "拍摄日期", value: displayValue(item?.FileSystem?.ShootingTimeString) },
    { key: "modification-date", label: "修改日期", value: displayValue(item?.FileSystem?.ModificationTimeString) },
    { key: "file-size", label: "文件大小", value: formatFileSize(item?.FileSystem?.FileSize) },
    { key: "resolution", label: "分辨率", value: formatMediaResolution(item) },
  ];

  if (item?.FileSystem?.FileType === "video") {
    rows.push(
      { key: "frame-rate", label: "帧率", value: formatVideoFrameRate(item?.Video?.FrameRate) },
      { key: "duration", label: "时长", value: formatDuration(item?.Video?.DurationSeconds) },
    );
  }

  const tags = Array.isArray(item?.Customization?.TagIds)
    ? item.Customization.TagIds.map((id) => resolvers.getTagText?.(id) || "").filter(Boolean).join(", ")
    : "";
  rows.push(
    { key: "location", label: "地点", value: displayValue(resolvers.getLocationName?.(item?.Location?.LocationId)) },
    { key: "tags", label: "标签", value: displayValue(tags) },
  );
  return rows;
}
