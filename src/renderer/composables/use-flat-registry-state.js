import { computed, reactive, ref } from "vue";
import { isRegistryFilterValueValid, matchesRegistrySearch } from "../domain/gallery-filter-state.mjs";

export function normalizeRegistryText(value) { return String(value ?? "").trim(); }

/** Shared flat catalog and dialog state; assignment and mutation rules stay with each owner. */
export function useFlatRegistryState({ idKey, labelKey, filterKey, query, unassignedFilter, pruneRecent }) {
  const labelField = labelKey[0].toLowerCase() + labelKey.slice(1);
  const registry = ref([]);
  const search = reactive({ viewer: "", batch: "" });
  const dropdown = reactive({ viewer: false, batch: false });
  const create = reactive({ visible: false, target: "viewer", [labelField]: "", description: "", error: "" });
  const manager = reactive({
    visible: false, search: "", editingId: "", ["edit" + labelKey]: "", editDescription: "", saving: false, error: "",
  });
  const managerFiltered = computed(() => {
    const keyword = manager.search.trim();
    const source = [...registry.value].sort((a, b) => a[labelKey].localeCompare(b[labelKey], "en-US"));
    return source.filter(item => matchesRegistrySearch(keyword, item[labelKey], item.Description));
  });
  function apply(entries) {
    registry.value = (Array.isArray(entries) ? entries : []).map(item => ({
      [idKey]: normalizeRegistryText(item?.[idKey]),
      [labelKey]: normalizeRegistryText(item?.[labelKey]),
      Description: normalizeRegistryText(item?.Description),
      CreatedAt: item?.CreatedAt || "",
      UpdatedAt: item?.UpdatedAt || "",
      UsageCount: Number(item?.UsageCount || 0),
    })).filter(item => item[idKey] && item[labelKey]);
    const ids = registry.value.map(item => item[idKey]);
    pruneRecent?.(ids);
    query.filters[filterKey] = query.filters[filterKey].filter(value => isRegistryFilterValueValid(value, ids, unassignedFilter));
  }
  function find(id) { return registry.value.find(item => item[idKey] === id) || null; }
  function candidates(target, selectedIds) {
    const selected = new Set(selectedIds);
    return registry.value
      .filter(item => matchesRegistrySearch(search[target], item[labelKey], item.Description))
      .sort((a, b) => Number(selected.has(b[idKey])) - Number(selected.has(a[idKey])) || a[labelKey].localeCompare(b[labelKey], "en-US"));
  }
  function startEdit(item) {
    if (manager.saving) return;
    Object.assign(manager, { editingId: item[idKey], ["edit" + labelKey]: item[labelKey] || "", editDescription: item.Description || "", error: "" });
  }
  function cancelEdit() {
    if (manager.saving) return;
    Object.assign(manager, { editingId: "", ["edit" + labelKey]: "", editDescription: "", error: "" });
  }
  return { registry, search, dropdown, create, manager, managerFiltered, apply, find, candidates, startEdit, cancelEdit };
}
