/** Return frame counts even on overflow so the renderer can explain the limit. */
function allocateVisualInputs(infos, slots = 8) {
  const counts = infos.map(info => info.kind === "text" ? 0 : info.kind === "image" ? 1 : 2);
  let remaining = slots - counts.reduce((sum, count) => sum + count, 0);
  let progress = true;
  while (remaining > 0 && progress) {
    progress = false;
    infos.forEach((info, index) => {
      const cap = info.kind === "video" ? 8 : info.kind === "gif" ? Math.min(4, info.pages) : counts[index];
      if (remaining > 0 && counts[index] < cap) {
        counts[index]++;
        remaining--;
        progress = true;
      }
    });
  }
  return counts;
}

module.exports = { allocateVisualInputs };
