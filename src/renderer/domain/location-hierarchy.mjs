export function normalizeLocationName(value) {
  return String(value ?? "").trim();
}

export function normalizeLocationField(value) {
  return String(value ?? "").trim();
}

export function getLocationRegionParts(location) {
  return [location?.Country, location?.Province, location?.City].map(normalizeLocationField).filter(Boolean);
}

export function getLocationRegionLabel(location) {
  return getLocationRegionParts(location).join(" / ");
}

export function getLocationRegionFilterLabel(region) {
  return [region?.country, region?.province, region?.city].map(normalizeLocationField).filter(Boolean).join(" / ");
}

export function locationMatchesRegionFilter(location, region) {
  const level = normalizeLocationField(region?.level);
  const country = normalizeLocationField(region?.country);
  const province = normalizeLocationField(region?.province);
  const city = normalizeLocationField(region?.city);
  if (level === "country") return normalizeLocationField(location?.Country) === country;
  if (level === "province") {
    return normalizeLocationField(location?.Country) === country
      && normalizeLocationField(location?.Province) === province;
  }
  if (level === "city") {
    return normalizeLocationField(location?.Country) === country
      && normalizeLocationField(location?.Province) === province
      && normalizeLocationField(location?.City) === city;
  }
  return false;
}

export function sameLocationRegionFilter(first, second) {
  return ["level", "country", "province", "city"]
    .every((field) => normalizeLocationField(first?.[field]) === normalizeLocationField(second?.[field]));
}

export function getLocationPathLabel(location) {
  const path = Array.isArray(location?.Path) && location.Path.length ? location.Path : [location?.Name].filter(Boolean);
  return path.join(" / ");
}

export function compareLocationsByRegionAndTree(a, b) {
  const keyA = [...getLocationRegionParts(a), ...getLocationPathLabel(a).split(" / "), a?.Name || ""].join("\u0001");
  const keyB = [...getLocationRegionParts(b), ...getLocationPathLabel(b).split(" / "), b?.Name || ""].join("\u0001");
  return keyA.localeCompare(keyB, "zh-CN");
}

export function locationMatchesKeyword(location, keyword) {
  if (!keyword) return true;
  const haystack = [
    location.Name,
    location.Country,
    location.Province,
    location.City,
    location.ParentId,
    location.Description,
    getLocationRegionLabel(location),
    getLocationPathLabel(location),
    ...(location.Path || []),
  ].join(" ");
  return haystack.includes(keyword);
}

export function getLocationManagerRowContext(row) {
  if (row?.Location) return getLocationRegionParts(row.Location).join(" | ");
  if (Array.isArray(row?.ContextParts) && row.ContextParts.length) return row.ContextParts.filter(Boolean).join(" | ");
  return "";
}

function getLocationGroupSpecs(location) {
  const specs = [];
  if (location.Country) specs.push({ level: "country", label: location.Country, order: 0 });
  if (location.Province) specs.push({ level: "province", label: location.Province, order: 2 });
  else if (location.City) specs.push({ level: "city", label: location.City, order: 1 });
  if (location.Province && location.City) specs.push({ level: "city", label: location.City, order: 1 });
  return specs;
}

function isLocationRepresentedByGroup(location, spec) {
  if (!spec) return false;
  if (spec.level === "country") return location.Name === location.Country && !location.Province && !location.City;
  if (spec.level === "province") return location.Name === location.Province && !location.City;
  if (spec.level === "city") return location.Name === location.City;
  return false;
}

function getReducedLocationPath(location, groupSpecs) {
  const groupLabels = new Set(groupSpecs.map((spec) => spec.label));
  const path = Array.isArray(location.Path) && location.Path.length ? [...location.Path] : [location.Name];
  while (path.length > 1 && groupLabels.has(path[0])) path.shift();
  return path.length ? path : [location.Name];
}

function compareLocationRowsByPath(a, b) {
  return (a.Label || "").localeCompare(b.Label || "", "zh-CN");
}

function buildLocationTreeRows(locationRows, baseDepth, representedLocationId = "", contextParts = []) {
  const byId = new Map(locationRows.map((row) => [row.Location.LocationId, row]));
  const children = new Map();
  const roots = [];
  for (const row of locationRows) {
    const parentId = normalizeLocationName(row.Location?.ParentId);
    if (parentId && parentId !== representedLocationId && byId.has(parentId)) {
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(row);
    } else {
      roots.push(row);
    }
  }
  const output = [];
  const visit = (row, depth, ancestryParts = []) => {
    const childRows = [...(children.get(row.Location.LocationId) || [])].sort(compareLocationRowsByPath);
    const rowContextParts = [...contextParts, ...ancestryParts, row.Label].filter(Boolean);
    output.push({ ...row, Depth: depth, HasChildren: childRows.length > 0, ContextParts: rowContextParts });
    for (const child of childRows) visit(child, depth + 1, [...ancestryParts, row.Label]);
  };
  for (const root of roots.sort(compareLocationRowsByPath)) visit(root, baseDepth + 1);
  return output;
}

function createRegionFilter(groupSpecs) {
  const region = { level: "", country: "", province: "", city: "" };
  for (const spec of groupSpecs) {
    region.level = spec.level;
    if (spec.level === "country") region.country = spec.label;
    if (spec.level === "province") region.province = spec.label;
    if (spec.level === "city") region.city = spec.label;
  }
  return region;
}

function createLocationGroupNode(key, label, level, depth, order, region) {
  return {
    Type: "group",
    Key: key,
    Label: label,
    Level: level,
    Depth: depth,
    Order: order,
    Region: region,
    Location: null,
    Groups: new Map(),
    Locations: [],
  };
}

/** Builds administrative groups and parent-first location rows for every location menu. */
export function buildLocationHierarchyRows(locations) {
  const root = { Key: "root", Groups: new Map(), Locations: [], Depth: -1 };
  for (const location of locations) {
    const specs = getLocationGroupSpecs(location);
    let parent = root;
    const groupPath = [];
    for (const spec of specs) {
      const key = `${parent.Key}>${spec.level}:${spec.label}`;
      if (!parent.Groups.has(key)) {
        parent.Groups.set(key, createLocationGroupNode(
          key,
          spec.label,
          spec.level,
          parent.Depth + 1,
          spec.order,
          createRegionFilter([...groupPath, spec]),
        ));
      }
      parent = parent.Groups.get(key);
      groupPath.push(spec);
    }
    const lastSpec = groupPath[groupPath.length - 1];
    if (isLocationRepresentedByGroup(location, lastSpec)) {
      parent.Location = location;
      parent.Key = `group-location:${location.LocationId}`;
      continue;
    }
    const reducedPath = getReducedLocationPath(location, groupPath);
    parent.Locations.push({
      Type: "location",
      Key: `location:${location.LocationId}`,
      Label: location.Name,
      Depth: parent.Depth + reducedPath.length,
      Location: location,
      SortKey: reducedPath.join("\u0001"),
      PathParts: reducedPath,
    });
  }

  const rows = [];
  const flatten = (node, contextParts = []) => {
    rows.push(...buildLocationTreeRows(node.Locations, node.Depth, node.Location?.LocationId, contextParts));
    const groups = [...node.Groups.values()].sort((a, b) => (a.Order - b.Order) || a.Label.localeCompare(b.Label, "zh-CN"));
    for (const group of groups) {
      const groupContextParts = [...contextParts, group.Label].filter(Boolean);
      rows.push({
        Type: "group",
        Key: group.Key,
        Label: group.Label,
        Depth: group.Depth,
        Location: group.Location,
        HasChildren: group.Locations.length > 0 || group.Groups.size > 0,
        ContextParts: groupContextParts,
        Region: group.Region,
      });
      flatten(group, groupContextParts);
    }
  };
  flatten(root);
  return rows;
}
