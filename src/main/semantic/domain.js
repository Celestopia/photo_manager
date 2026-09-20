const { createHash } = require("node:crypto");
const manifest = require("./model-manifest.json");
const hash = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
const profiles = Object.freeze({
  visual: hash({
    model: manifest.models.find((m) => m.id === "clip"),
    preprocessing: 1,
    sampling: 1,
  }),
  description: hash({
    model: manifest.models.find((m) => m.id === "minilm"),
    projection: 1,
    chunking: 1,
  }),
  context: hash({
    model: manifest.models.find((m) => m.id === "minilm"),
    projection: 1,
    chunking: 1,
  }),
});
const dimensions = { visual: 512, description: 384, context: 384 };
function project(item, registries) {
  const c = item.Customization,
    location = item.Location;
  const line = (label, value) =>
    typeof value === "string" && value.trim()
      ? `${label}: ${JSON.stringify(
          value
            .normalize("NFC")
            .replace(/\r\n?/g, "\n")
            .replace(/[\t ]+/g, " ")
            .trim(),
        )}`
      : "";
  const assigned = (ids, map, label) =>
    [...ids].sort().flatMap((id) => {
      const row = map.get(id);
      return row
        ? [
            line(label, row.Text ?? row.Title ?? row.Name),
            line(label + " description", row.Description),
          ]
        : [];
    });
  const ancestors = [],
    seen = new Set();
  let id = location.LocationId;
  while (id) {
    if (seen.has(id)) throw new Error("Location cycle");
    seen.add(id);
    const row = registries.locations.get(id);
    if (!row) break;
    ancestors.unshift(row);
    id = row.ParentId;
  }
  const place = ancestors.at(-1);
  const description = [
    line("Title", c.Title),
    line("Description", c.Description),
    ...assigned(c.TagIds, registries.tags, "Tag"),
  ]
    .filter(Boolean)
    .join("\n");
  const context = [
    ...assigned(c.PersonIds, registries.people, "Person"),
    ...assigned(c.AlbumId ? [c.AlbumId] : [], registries.albums, "Album"),
    line(
      "Region",
      place
        ? [place.Country, place.Province, place.City]
            .filter(Boolean)
            .join(" / ")
        : "",
    ),
    line("Location", ancestors.map((r) => r.Name).join(" / ")),
    ...ancestors.map((r) => line("Location description", r.Description)),
    line("Location detail", location.Detail),
  ]
    .filter(Boolean)
    .join("\n");
  return {
    description,
    context,
    fingerprints: {
      description: hash({ text: description, profile: profiles.description }),
      context: hash({ text: context, profile: profiles.context }),
      visual: hash({ hash: item.SHA256Hash, profile: profiles.visual }),
    },
  };
}
function sampleCount(d) {
  if (!Number.isFinite(d) || d <= 0)
    throw new Error("Video duration is unavailable");
  return d < 10
    ? 10
    : d < 60
      ? Math.ceil((2 * d) / 5 + 6)
      : d <= 600
        ? Math.ceil(d / 6 + 20)
        : 120;
}
// Choose distinct frames nearest uniform times while reserving enough frames for later targets.
function selectFrames(times, count) {
  if (!times.length) return [];
  const n = Math.min(count, times.length),
    out = [];
  let previous = -1;
  for (let i = 0; i < n; i++) {
    const target =
      n === 1 ? times[0] : times[0] + (i * (times.at(-1) - times[0])) / (n - 1);
    let lo = previous + 1,
      hi = times.length - (n - i),
      best = lo;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < target) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (
      best + 1 <= times.length - (n - i) &&
      Math.abs(times[best + 1] - target) < Math.abs(times[best] - target)
    )
      best++;
    out.push(best);
    previous = best;
  }
  return out;
}
function resultLimit(value) {
  if (!Number.isInteger(value) || value < 1 || value > 100)
    throw new Error("Results must be an integer from 1 to 100");
  return value;
}
function validateQuery(q) {
  const keys = ["visualQuery", "descriptiveQuery", "contextualQuery"];
  if (
    !q ||
    typeof q !== "object" ||
    Array.isArray(q) ||
    Object.keys(q).sort().join() !== [...keys].sort().join() ||
    keys.some((k) => typeof q[k] !== "string" || q[k].length > 2000) ||
    !keys.some((k) => q[k].trim())
  )
    throw new Error(
      "Provide only visualQuery, descriptiveQuery and contextualQuery strings; at least one must be nonempty.",
    );
  return Object.fromEntries(keys.map((k) => [k, q[k].trim()]));
}
module.exports = {
  hash,
  profiles,
  dimensions,
  project,
  sampleCount,
  selectFrames,
  resultLimit,
  validateQuery,
};
