function groupMediaPathsByHash(entries, { skipMissing = false } = {}) {
  const groups = new Map();
  for (const item of entries) {
    if (skipMissing && !item.SHA256Hash) continue;
    if (!groups.has(item.SHA256Hash)) groups.set(item.SHA256Hash, []);
    groups.get(item.SHA256Hash).push(item.FilePath);
  }
  return groups;
}

function countMediaTypes(entries) {
  const counts = { images: 0, videos: 0 };
  for (const item of entries) {
    if (item?.FileSystem?.FileType === "image") counts.images++;
    if (item?.FileSystem?.FileType === "video") counts.videos++;
  }
  return counts;
}

module.exports = { groupMediaPathsByHash, countMediaTypes };
