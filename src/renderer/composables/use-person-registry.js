import { useFlatRegistryState, normalizeRegistryText as normalizeText } from "./use-flat-registry-state.js";
import { createRegistryRequests } from "../domain/registry-requests.mjs";
import {
  patchRegistryReferencesInPlace,
  registryDeletionInvalidatesFilter,
  removeRegistryReference,
} from "../domain/registry-deletion.mjs";


/** Owns the ID-backed people registry, picker state, and management workflow. */
export function usePersonRegistry({
  requestConfirm,
  api, unassignedFilter, query, editDraft, batchEdit, selectedItem, orderedItems,
  gallerySettingsOpen, recentPeople, rememberRecentPerson, pruneRecentPeople,
  showToastMessage, closeOtherRegistryDropdowns, requestEdit,
  queryGallery,
}) {
  const {
    registry: personRegistry, search: personSearch, dropdown: personDropdown,
    create: personCreate, manager: personManager, managerFiltered: managerFilteredPeople, apply: applyPersonRegistry,
  } = useFlatRegistryState({
    idKey: "PersonId", labelKey: "Name", filterKey: "person", query, unassignedFilter, pruneRecent: pruneRecentPeople,
  });
  const requests = createRegistryRequests(personManager);

  async function loadPeople() {
    const result = await requests.run(() => api.listPeople?.(), { read: true });
    if (result?.ok) applyPersonRegistry(result.people);
    else if (result) showToastMessage(result.error || "Could not load people");
  }
  function selectedPersonIdsForTarget(target) { return target === "batch" ? batchEdit.personIds : editDraft.PersonIds; }
  function getPersonDefinition(personId) { return personRegistry.value.find((person) => person.PersonId === personId) || null; }
  function getPersonDescription(personId) { return getPersonDefinition(personId)?.Description || ""; }
  function getPersonName(personId) { return getPersonDefinition(personId)?.Name || ""; }
  function getPersonCandidates(target) {
    const keyword = normalizeText(personSearch[target]);
    const selected = new Set(selectedPersonIdsForTarget(target));
    return personRegistry.value
      .filter((person) => !keyword || person.Name.includes(keyword) || person.Description.includes(keyword))
      .sort((a, b) => Number(selected.has(b.PersonId)) - Number(selected.has(a.PersonId)) || a.Name.localeCompare(b.Name, "en-US"));
  }
  function getPersonOptions(target) { return getPersonCandidates(target).slice(0, 50); }
  function getRecentPersonOptions(target) {
    const byId = new Map(getPersonCandidates(target).map((person) => [person.PersonId, person]));
    return recentPeople.value.map((id) => byId.get(id)).filter(Boolean).slice(0, 3);
  }

  function openPersonDropdown(target) {
    const shouldOpen = !personDropdown[target];
    closeOtherRegistryDropdowns?.();
    personDropdown[target] = shouldOpen;
  }
  function closePersonDropdown(target) { personDropdown[target] = false; }
  function closeAllPersonDropdowns() { personDropdown.viewer = false; personDropdown.batch = false; }

  function addPersonToTarget(target, personId) {
    const definition = getPersonDefinition(personId);
    if (!definition) return;
    const ids = selectedPersonIdsForTarget(target);
    if (ids.includes(personId)) showToastMessage(`Person “${definition.Name}” is already assigned`);
    else {
      ids.push(personId);
      rememberRecentPerson(personId);
      if (target === "viewer") requestEdit("People");
    }
    personSearch[target] = "";
    closePersonDropdown(target);
  }
  function openCreatePersonMenu(target) {
    if (personManager.saving) return;
    closeOtherRegistryDropdowns?.();
    Object.assign(personCreate, {
      visible: true, target,
      name: target === "manager" ? "" : normalizeText(personSearch[target]),
      description: "", error: "",
    });
    if (target !== "manager") closePersonDropdown(target);
  }
  function closeCreatePersonMenu() {
    if (personManager.saving) return; Object.assign(personCreate, { visible: false, name: "", description: "", error: "" }); }
  async function createPersonAndSelect() {
    if (personManager.saving) return;
    const name = normalizeText(personCreate.name);
    if (!name) { personCreate.error = "Person name is required"; return; }
    const target = personCreate.target;
    const mediaId = selectedItem.value?.MediaId;
    const result = await requests.run(() => api.createPerson({ name, description: normalizeText(personCreate.description) }), { ownsTarget: () => personCreate.visible && personCreate.target === target && (target !== "viewer" || selectedItem.value?.MediaId === mediaId) });
    if (!result) return;
    if (!result?.ok) { personCreate.error = result?.error || "Could not create person"; return; }
    applyPersonRegistry(result.people);
    if (target === "manager") showToastMessage(`Created person “${result.person.Name}”`);
    else addPersonToTarget(target, result.person.PersonId);
    closeCreatePersonMenu();
  }

  async function openPersonManager() {
    gallerySettingsOpen.value = false;
    closeOtherRegistryDropdowns?.();
    if (personManager.saving) return;
    personManager.visible = true;
    personManager.error = "";
    await loadPeople();
  }
  function closePersonManager() {
    if (personManager.saving) return;
    if (personCreate.target === "manager") closeCreatePersonMenu();
    Object.assign(personManager, {
      visible: false, search: "", editingId: "", editName: "", editDescription: "", saving: false, error: "",
    });
  }
  function startPersonEdit(person) {
    if (personManager.saving) return;
    Object.assign(personManager, {
      editingId: person.PersonId, editName: person.Name || "", editDescription: person.Description || "", saving: false, error: "",
    });
  }
  function cancelPersonEdit() {
    if (personManager.saving) return;
    Object.assign(personManager, { editingId: "", editName: "", editDescription: "", saving: false, error: "" });
  }
  async function savePersonEdit() {
    if (personManager.saving) return;
    const personId = personManager.editingId;
    const name = normalizeText(personManager.editName);
    if (!personId) { personManager.error = "Person not found"; return; }
    if (!name) { personManager.error = "Person name is required"; return; }
    const previousName = getPersonName(personId);
    const result = await requests.run(() => api.updatePerson({ personId, name, description: normalizeText(personManager.editDescription) }));
    if (!result) return;
    if (!result?.ok) { personManager.error = result?.error || "Could not save person"; return; }
    applyPersonRegistry(result.people);
    cancelPersonEdit();
    showToastMessage(previousName === name ? "Person updated" : `Renamed person “${previousName}” to “${name}”`);
  }

  function syncDeletedPersonLocally(personId, patchGallery) {
    if (selectedItem.value) selectedItem.value = removeRegistryReference(selectedItem.value, "person", personId);
    editDraft.PersonIds = editDraft.PersonIds.filter((id) => id !== personId);
    batchEdit.personIds = batchEdit.personIds.filter((id) => id !== personId);
    if (patchGallery) patchRegistryReferencesInPlace(orderedItems.value, "person", personId);
  }
  async function deletePersonGlobally(person) {
    if (personManager.saving) return;
    const usage = Number(person?.UsageCount || 0);
    const stillCurrent = requests.capture();
    if (!await requestConfirm({ title: "Delete person?", confirmLabel: "Delete person", danger: true, message: `Delete person “${person.Name}” from the entire library? This will remove them from ${usage} media item(s).` + "\n\nMedia files will remain unchanged." }) || !stillCurrent()) return;
    const result = await requests.run(() => api.deletePersonGlobally({ personId: person.PersonId }));
    if (!result) return;
    if (!result?.ok) { showToastMessage(`Could not delete person: ${result?.error || "Unknown error"}`); return; }
    const filterBeforeDelete = query.filters.person;
    const shouldRefreshGallery = registryDeletionInvalidatesFilter(
      filterBeforeDelete, person.PersonId, unassignedFilter, result.updatedCount,
    );
    applyPersonRegistry(result.people);
    syncDeletedPersonLocally(person.PersonId, Number(result.updatedCount) > 0 && !shouldRefreshGallery);
    const current = requests.capture();
    if (shouldRefreshGallery) await queryGallery();
    if (!current()) return;
    showToastMessage(`Deleted person “${person.Name}” from the library`);
  }

  function resetPersonState() {
    requests.reset();
    personRegistry.value = [];
    Object.assign(personSearch, { viewer: "", batch: "" });
    closeAllPersonDropdowns(); closeCreatePersonMenu();
    Object.assign(personManager, {
      visible: false, search: "", editingId: "", editName: "", editDescription: "", saving: false, error: "",
    });
  }

  return {
    personRegistry, personSearch, personDropdown, personCreate, personManager,
    managerFilteredPeople, loadPeople, getPersonOptions, getRecentPersonOptions,
    getPersonDescription, getPersonName, openPersonDropdown, closePersonDropdown,
    closeAllPersonDropdowns, addPersonToTarget,
    openCreatePersonMenu, closeCreatePersonMenu, createPersonAndSelect,
    openPersonManager, closePersonManager, startPersonEdit,
    cancelPersonEdit, savePersonEdit, deletePersonGlobally, resetPersonState,
  };
}
