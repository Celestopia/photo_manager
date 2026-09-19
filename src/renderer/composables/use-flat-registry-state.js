import { computed, reactive, ref } from "vue";
import { isRegistryFilterValueValid } from "../domain/gallery-filter-state.mjs";

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
    return keyword ? source.filter(item => item[labelKey].includes(keyword) || item.Description.includes(keyword)) : source;
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
    if (!isRegistryFilterValueValid(query.filters[filterKey], ids, unassignedFilter)) query.filters[filterKey] = "";
  }
  return { registry, search, dropdown, create, manager, managerFiltered, apply };
}
