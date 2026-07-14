/** Format raw bytes for the metadata side panel. */
export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Convert a local filesystem path into an Electron-compatible file URL. */
export function buildImageUrl(absolutePath) {
  if (!absolutePath) return "";
  const normalized = absolutePath.replace(/\\/g, "/");
  const encoded = normalized
    .split("/")
    .map((segment, index) => (index === 0 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join("/");
  return normalized.startsWith("//") ? `file:${encoded}` : `file:///${encoded}`;
}

export function formatDuration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || value === null || value === undefined) return "-";
  const total = Math.max(0, Math.floor(numeric));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatBitRate(value) {
  const bits = Number(value);
  if (!Number.isFinite(bits) || bits <= 0) return "-";
  if (bits >= 1000000) return `${(bits / 1000000).toFixed(2)} Mbps`;
  return `${Math.round(bits / 1000)} Kbps`;
}
