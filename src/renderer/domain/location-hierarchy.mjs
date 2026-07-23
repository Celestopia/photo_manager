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

/** Keeps keyword matches together with every registered location ancestor needed to explain their path. */
export function filterLocationsWithAncestors(locations, keywordValue) {
  const keyword = normalizeLocationName(keywordValue);
  if (!keyword) return [...locations];
  const byId = new Map(locations.map((location) => [location.LocationId, location]));
  const includedIds = new Set();
  for (const location of locations) {
    if (!locationMatchesKeyword(location, keyword)) continue;
    let current = location;
    const ancestryGuard = new Set();
    while (current?.LocationId && !ancestryGuard.has(current.LocationId)) {
      ancestryGuard.add(current.LocationId);
      includedIds.add(current.LocationId);
      current = current.ParentId ? byId.get(current.ParentId) : null;
    }
  }
  return locations.filter((location) => includedIds.has(location.LocationId));
}

export function getLocationManagerRowContext(row) {
  if (row?.Location) return getLocationRegionParts(row.Location).join(" | ");
  if (Array.isArray(row?.ContextParts) && row.ContextParts.length) return row.ContextParts.filter(Boolean).join(" | ");
  return "";
}

function getLocationGroupSpecs(location) {
  const specs = [];
  if (location.Country) specs.push({ level: "country", label: location.Country, order: 0, depth: 0 });
  if (location.Province) specs.push({ level: "province", label: location.Province, order: 2, depth: 1 });
  else if (location.City) specs.push({ level: "city", label: location.City, order: 1, depth: 2 });
  if (location.Province && location.City) specs.push({ level: "city", label: location.City, order: 1, depth: 2 });
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

function buildLocationTreeRows(
  locationRows,
  baseDepth,
  representedLocationId = "",
  contextParts = [],
  parentExpansionKeys = [],
) {
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
  const visit = (
    row,
    depth,
    ancestryParts = [],
    requiredExpansionKeys = parentExpansionKeys,
  ) => {
    const childRows = [...(children.get(row.Location.LocationId) || [])].sort(compareLocationRowsByPath);
    const rowContextParts = [...contextParts, ...ancestryParts, row.Label].filter(Boolean);
    output.push({
      ...row,
      Depth: depth,
      HasChildren: childRows.length > 0,
      HasExpandableChildren: childRows.length > 0,
      ParentExpansionKey: requiredExpansionKeys[requiredExpansionKeys.length - 1] || "",
      RequiredExpansionKeys: requiredExpansionKeys,
      ContextParts: rowContextParts,
    });
    for (const child of childRows) {
      visit(child, depth + 1, [...ancestryParts, row.Label], [...requiredExpansionKeys, row.Key]);
    }
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
    if (!specs.length) specs.push({ level: "unassigned", label: "未设置行政区", order: -1, depth: 0 });
    let parent = root;
    const groupPath = [];
    for (const spec of specs) {
      const key = `${parent.Key}>${spec.level}:${spec.label}`;
      if (!parent.Groups.has(key)) {
        parent.Groups.set(key, createLocationGroupNode(
          key,
          spec.label,
          spec.level,
          spec.depth,
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
  const flatten = (node, contextParts = [], groupExpansionPath = []) => {
    const locationExpansionPath = node.Key === "root"
      ? groupExpansionPath
      : [...groupExpansionPath, `group-locations:${node.Key}`];
    rows.push(...buildLocationTreeRows(
      node.Locations,
      node.Depth,
      node.Location?.LocationId,
      contextParts,
      locationExpansionPath,
    ));
    const groups = [...node.Groups.values()].sort((a, b) => (a.Order - b.Order) || a.Label.localeCompare(b.Label, "zh-CN"));
    for (const group of groups) {
      const groupContextParts = [...contextParts, group.Label].filter(Boolean);
      rows.push({
        Type: "group",
        Key: group.Key,
        Label: group.Label,
        Level: group.Level,
        Depth: group.Depth,
        Location: group.Location,
        HasChildren: group.Locations.length > 0 || group.Groups.size > 0,
        HasExpandableChildren: group.Locations.length > 0 || group.Groups.size > 0,
        RequiredExpansionKeys: groupExpansionPath,
        ContextParts: groupContextParts,
        Region: group.Region,
      });
      flatten(group, groupContextParts, [...groupExpansionPath, group.Key]);
    }
  };
  flatten(root);
  return rows;
}

/** Returns the rows visible in a folded picker without changing the complete hierarchy order. */
export function getVisibleLocationHierarchyRows(rows, expandedKeysValue, searchActive = false) {
  const expandedKeys = expandedKeysValue instanceof Set
    ? expandedKeysValue
    : new Set(Array.isArray(expandedKeysValue) ? expandedKeysValue : []);
  return rows.filter((row) => {
    if (row.Type === "section" || row.Pinned || searchActive) return true;
    const requiredKeys = Array.isArray(row.RequiredExpansionKeys)
      ? row.RequiredExpansionKeys
      : [row.ParentExpansionKey].filter(Boolean);
    return requiredKeys.every((key) => expandedKeys.has(key));
  });
}

/** Countries and provinces start open so administrative rows are visible through city level. */
export function getDefaultLocationExpansionKeys(rows) {
  return rows
    .filter((row) => row.Type === "group" && ["country", "province"].includes(row.Level))
    .map((row) => row.Key);
}
