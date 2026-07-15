const { assertOptionalUuidV4 } = require("../shared/identity-schema.js");

function normalizeLocationName(value) {
  return String(value ?? "").trim();
}

function normalizeLocationField(value) {
  return String(value ?? "").trim();
}

function normalizeLocationObject(rawLocation) {
  const source = rawLocation && typeof rawLocation === "object" ? rawLocation : {};
  return {
    LocationId: assertOptionalUuidV4(source.LocationId, "LocationId"),
    Detail: normalizeLocationField(source.Detail),
  };
}

function createLocationDomain(getRegistryIndex) {
  function getLocationChildrenMap() {
    const registry = getRegistryIndex();
    const children = new Map();
    for (const locationId of registry.keys()) children.set(locationId, []);
    for (const location of registry.values()) {
      if (!location.ParentId || !registry.has(location.ParentId)) continue;
      children.get(location.ParentId).push(location.LocationId);
    }
    for (const ids of children.values()) {
      ids.sort((a, b) => registry.get(a).Name.localeCompare(registry.get(b).Name, "zh-CN"));
    }
    return children;
  }

  function getLocationDescendants(locationId) {
    const children = getLocationChildrenMap();
    const output = [];
    const stack = [...(children.get(locationId) || [])];
    const seen = new Set();
    while (stack.length) {
      const current = stack.pop();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      output.push(current);
      stack.push(...(children.get(current) || []));
    }
    return output;
  }

  function buildLocationPath(locationId) {
    const registry = getRegistryIndex();
    const parts = [];
    const seen = new Set();
    let current = locationId;
    while (current && registry.has(current) && !seen.has(current)) {
      seen.add(current);
      const location = registry.get(current);
      parts.unshift(location.Name);
      current = location.ParentId;
    }
    return parts;
  }

  function getLocationDepth(locationId) {
    return Math.max(0, buildLocationPath(locationId).length - 1);
  }

  function validateLocationParent(locationId, rawParentId) {
    const registry = getRegistryIndex();
    const parentId = assertOptionalUuidV4(rawParentId, "ParentId");
    if (!parentId) return { ok: true, parentId: null };
    if (!registry.has(parentId)) return { ok: false, error: "Parent location not found" };
    if (parentId === locationId) return { ok: false, error: "Location cannot be its own parent" };
    if (locationId && getLocationDescendants(locationId).includes(parentId)) {
      return { ok: false, error: "Parent cannot be a descendant location" };
    }
    return { ok: true, parentId };
  }

  return {
    buildLocationPath,
    getLocationChildrenMap,
    getLocationDepth,
    getLocationDescendants,
    validateLocationParent,
  };
}

module.exports = {
  createLocationDomain,
  normalizeLocationField,
  normalizeLocationName,
  normalizeLocationObject,
};
