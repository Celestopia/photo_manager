const { exact, text } = require("../../shared/agent-schema");
const FIELDS = ["type", "title", "description", "tag", "person", "album", "location", "date", "rating", "privacy", "duration", "gps"];
const fold = value => String(value).normalize("NFC").toLocaleLowerCase("en-US");
function validateTree(tree) {
  let leaves = 0;
  function visit(node, depth) {
    if (depth > 3) throw new Error("Predicate tree exceeds depth 3");
    if (node && (Object.hasOwn(node, "all") || Object.hasOwn(node, "any"))) {
      const op = Object.hasOwn(node, "all") ? "all" : "any"; exact(node, [op]);
      if (!Array.isArray(node[op]) || node[op].length > 12 || op === "any" && !node[op].length) throw new Error("Invalid boolean predicate");
      node[op].forEach(child => visit(child, depth + 1)); return;
    }
    exact(node, ["field", "operator", "value", "policy", "source"]);
    if (++leaves > 12 || !FIELDS.includes(node.field) || !["eq", "in", "range", "contains", "not"].includes(node.operator) || !["required", "ordinary", "preferred"].includes(node.policy)) throw new Error("Unsupported predicate");
    text(node.source, 400);
    if (!node.source.trim()) throw new Error("Predicate source cannot be empty");
    if (node.field === "gps") {
      exact(node.value, ["latitude", "longitude", "radiusKm"]);
      const { latitude, longitude, radiusKm } = node.value;
      if (![latitude, longitude, radiusKm].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || radiusKm <= 0 || radiusKm > 20040 || !["eq", "not"].includes(node.operator)) throw new Error("Invalid GPS radius");
      return;
    }
    const values = ["in", "range"].includes(node.operator) ? node.value : [node.value];
    if (!Array.isArray(values) || !values.length || values.length > 20 || node.operator === "range" && values.length !== 2) throw new Error("Invalid predicate values");
    for (const value of values) {
      if (["rating", "privacy", "duration"].includes(node.field)) {
        if (!Number.isFinite(value) || value < 0 || node.field !== "duration" && (!Number.isInteger(value) || value < 1 || value > 5)) throw new Error("Invalid numeric predicate");
      } else { text(value, 256); if (!value.trim()) throw new Error("Empty predicate value"); }
    }
    if (node.operator === "range" && (!["date", "duration", "rating", "privacy"].includes(node.field) || values[0] > values[1])) throw new Error("Invalid range");
    if (node.field === "date" && values.some(value => !/^\d{4}(?:-\d{2}(?:-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?)?)?$/.test(value))) throw new Error("Invalid ISO date");
    if (node.field === "date") for (const value of values) {
      const date = value.slice(0, 10), parts = date.split('-').map(Number);
      if (parts[0] < 1 || parts[0] > 9999 || parts.length > 1 && (parts[1] < 1 || parts[1] > 12) || parts.length > 2 && (parts[2] < 1 || parts[2] > new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate())) throw new Error("Invalid calendar date");
      if (value.length > 10 && !Number.isFinite(Date.parse(value.replace(' ', 'T')))) throw new Error("Invalid date-time");
    }
    if (node.field === "type" && values.some(value => !["image", "video"].includes(value))) throw new Error("Invalid media type");
  }
  visit(tree, 0);
}
function compare(actual, p) {
  if (actual === undefined || actual === null || actual === "") return "unknown";
  const values = Array.isArray(p.value) ? p.value : [p.value];
  let match = p.operator === "range" ? actual >= values[0] && actual <= values[1]
    : p.operator === "contains" ? fold(actual).includes(fold(values[0])) : values.some(value => typeof actual === "number" ? value === actual : fold(value) === fold(actual));
  if (p.operator === "not") match = !match;
  return match ? "match" : "mismatch";
}
function gps(parts, ref) {
  return Array.isArray(parts) && parts.length === 3 && parts.every(Number.isFinite) && ["N", "S", "E", "W"].includes(ref)
    ? (parts[0] + parts[1] / 60 + parts[2] / 3600) * (["S", "W"].includes(ref) ? -1 : 1) : null;
}
function leaf(item, p, registries) {
  const c = item.Customization;
  if (p.field === "date") {
    const date = item.FileSystem?.ShootingTimeString, values = Array.isArray(p.value) ? p.value : [p.value];
    if (values.some(value => /(?:Z|[+-]\d\d:\d\d)$/.test(value))) return compare(item.FileSystem?.ShootingTimeStamp, { ...p, value: Array.isArray(p.value) ? values.map(value => Date.parse(value)) : Date.parse(p.value) });
    if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return "unknown";
    const match = p.operator === "range" ? date.slice(0, values[0].length) >= values[0] && date.slice(0, values[1].length) <= values[1] : values.some(value => date.startsWith(value));
    return (p.operator === "not" ? !match : match) ? "match" : "mismatch";
  }
  if (p.field === "gps") {
    const a = gps(item.GPS?.Latitude, item.GPS?.LatitudeRef), b = gps(item.GPS?.Longitude, item.GPS?.LongitudeRef);
    if (a === null || b === null) return "unknown";
    const rad = Math.PI / 180, { latitude, longitude, radiusKm } = p.value;
    const h = Math.sin((latitude - a) * rad / 2) ** 2 + Math.cos(a * rad) * Math.cos(latitude * rad) * Math.sin((longitude - b) * rad / 2) ** 2;
    const match = 12742 * Math.asin(Math.sqrt(Math.min(1, h))) <= radiusKm;
    return (p.operator === "not" ? !match : match) ? "match" : "mismatch";
  }
  const scalars = { type: item.FileSystem?.FileType, rating: c.Rating, privacy: c.Privacy, duration: item.Video?.DurationSeconds, title: c.Title, description: c.Description };
  if (Object.hasOwn(scalars, p.field)) return compare(scalars[p.field], p);
  const map = registries[{ tag: "tags", person: "people", album: "albums", location: "locations" }[p.field]];
  const idKey = { tag: "TagId", person: "PersonId", album: "AlbumId", location: "LocationId" }[p.field];
  const assigned = (p.field === "tag" ? c.TagIds : p.field === "person" ? c.PersonIds : p.field === "album" ? [c.AlbumId] : [item.Location?.LocationId]).filter(Boolean);
  if (p.field === "location") {
    const seen = new Set(assigned); let location = map.get(assigned[0]);
    while (location?.ParentId && !seen.has(location.ParentId)) { assigned.push(location.ParentId); seen.add(location.ParentId); location = map.get(location.ParentId); }
  }
  if (!assigned.length) return "unknown";
  let known = false, match = false, indeterminateParent = false;
  for (const value of Array.isArray(p.value) ? p.value : [p.value]) {
    const targets = map.has(value) ? [map.get(value)] : [...map.values()].filter(record => [record.Text, record.Title, record.Name].some(label => label && (p.operator === "contains" ? fold(label).includes(fold(value)) : fold(label) === fold(value))));
    if (targets.length > 1 && p.operator !== "contains") throw Object.assign(new Error(`Ambiguous ${p.field}: ${value}; choose its UUID or use a gallery filter`), { code: "AMBIGUOUS_REGISTRY" });
    known ||= targets.length > 0; match ||= targets.some(target => assigned.includes(target[idKey]));
    if (p.field === "location") {
      for (const id of assigned) if ([map.get(id)?.Country, map.get(id)?.Province, map.get(id)?.City].some(region => region && fold(region) === fold(value))) { known = true; match = true; }
      for (const target of targets) { let parent = target; const seen = new Set(); while (parent?.ParentId && !seen.has(parent.ParentId)) { seen.add(parent.ParentId); if (assigned.includes(parent.ParentId)) indeterminateParent = true; parent = map.get(parent.ParentId); } }
    }
  }
  if (!known || !match && indeterminateParent) return "unknown";
  return (p.operator === "not" ? !match : match) ? "match" : "mismatch";
}
function evaluateTree(item, tree, registries) {
  const evidence = []; let preferred = 0;
  function visit(node) {
    if (node.all || node.any) {
      const outcomes = (node.all || node.any).map(visit).filter(outcome => outcome !== "preferred");
      if (!outcomes.length) return "preferred";
      return node.all ? outcomes.includes("mismatch") ? "mismatch" : outcomes.includes("unknown") ? "unknown" : "match"
        : outcomes.includes("match") ? "match" : outcomes.includes("unknown") ? "unknown" : "mismatch";
    }
    const state = leaf(item, node, registries); evidence.push({ field: node.field, value: node.value, state, policy: node.policy });
    if (node.policy === "preferred") { if (state === "match") preferred++; return "preferred"; }
    return state === "unknown" && (node.policy === "required" || node.operator === "not") ? "mismatch" : state;
  }
  const state = visit(tree); return { excluded: state === "mismatch", unknown: state === "unknown", preferred, evidence };
}
module.exports = { validateTree, evaluateTree };
