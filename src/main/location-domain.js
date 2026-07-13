function normalizeLocationName(value) {
  return String(value ?? "").trim();
}

function normalizeLocationField(value) {
  return String(value ?? "").trim();
}

function normalizeLocationObject(rawLocation) {
  const source = rawLocation && typeof rawLocation === "object" ? rawLocation : {};
  return {
    Place: normalizeLocationName(source.Place ?? source.Site),
    Detail: normalizeLocationField(source.Detail),
  };
}

function createLocationDomain(getRegistryIndex) {
  function getLocationChildrenMap() {
    const registry = getRegistryIndex();
    const children = new Map();
    for (const location of registry.values()) {
      if (!children.has(location.Name)) children.set(location.Name, []);
    }
    for (const location of registry.values()) {
      const parent = normalizeLocationName(location.Parent);
      if (!parent || !registry.has(parent)) continue;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(location.Name);
    }
    for (const names of children.values()) names.sort((a, b) => a.localeCompare(b, "zh-CN"));
    return children;
  }

  function getLocationDescendants(name) {
    const root = normalizeLocationName(name);
    const children = getLocationChildrenMap();
    const output = [];
    const stack = [...(children.get(root) || [])];
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

  function buildLocationPath(name) {
    const registry = getRegistryIndex();
    const parts = [];
    const seen = new Set();
    let current = normalizeLocationName(name);
    while (current && registry.has(current) && !seen.has(current)) {
      seen.add(current);
      parts.unshift(current);
      current = normalizeLocationName(registry.get(current)?.Parent);
    }
    return parts;
  }

  function getLocationDepth(name) {
    return Math.max(0, buildLocationPath(name).length - 1);
  }

  function validateLocationParent(name, parent) {
    const registry = getRegistryIndex();
    const normalizedName = normalizeLocationName(name);
    const normalizedParent = normalizeLocationName(parent);
    if (!normalizedParent) return { ok: true, parent: "" };
    if (!registry.has(normalizedParent)) return { ok: false, error: "Parent location not found" };
    if (normalizedParent === normalizedName) return { ok: false, error: "Location cannot be its own parent" };
    if (normalizedName && getLocationDescendants(normalizedName).includes(normalizedParent)) {
      return { ok: false, error: "Parent cannot be a descendant location" };
    }
    return { ok: true, parent: normalizedParent };
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
