import { ref } from "vue";

function normalizeValue(value) {
  return String(value ?? "").trim();
}

/** Stores the three most recently selected tags, people, and locations per library. */
export function useRecentRegistryHistory({ libraryState }) {
  const recentTags = ref([]);
  const recentPeople = ref([]);
  const recentLocations = ref([]);

  function storageKey(kind) {
    const libraryId = libraryState.value.active?.libraryId || "closed";
    return `photoManager.library.${libraryId}.recent${kind}`;
  }

  function load(kind) {
    try {
      const parsed = JSON.parse(window.localStorage?.getItem(storageKey(kind)) || "[]");
      return Array.isArray(parsed) ? parsed.map(normalizeValue).filter(Boolean).slice(0, 3) : [];
    } catch {
      return [];
    }
  }

  function save(kind, values) {
    try {
      window.localStorage?.setItem(storageKey(kind), JSON.stringify(values.slice(0, 3)));
    } catch {
      // Recent values are a convenience cache and must never block editing.
    }
  }

  function remember(targetRef, kind, rawValue) {
    const value = normalizeValue(rawValue);
    if (!value) return;
    targetRef.value = [value, ...targetRef.value.filter((item) => item !== value)].slice(0, 3);
    save(kind, targetRef.value);
  }

  function prune(targetRef, kind, knownValues) {
    const known = new Set(knownValues.map(normalizeValue));
    targetRef.value = targetRef.value.filter((value) => known.has(value)).slice(0, 3);
    save(kind, targetRef.value);
  }

  function loadLibraryRecentValues() {
    recentTags.value = load("Tags");
    recentPeople.value = load("People");
    recentLocations.value = load("Locations");
  }

  function resetRecentValues() {
    recentTags.value = [];
    recentPeople.value = [];
    recentLocations.value = [];
  }

  return {
    recentTags,
    recentPeople,
    recentLocations,
    loadLibraryRecentValues,
    resetRecentValues,
    rememberRecentTag: (value) => remember(recentTags, "Tags", value),
    rememberRecentPerson: (value) => remember(recentPeople, "People", value),
    rememberRecentLocation: (value) => remember(recentLocations, "Locations", value),
    pruneRecentTags: (values) => prune(recentTags, "Tags", values),
    pruneRecentPeople: (values) => prune(recentPeople, "People", values),
    pruneRecentLocations: (values) => prune(recentLocations, "Locations", values),
  };
}
