const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { commitTextTransaction, serializeJsonl } = require("../../../scripts/library-transaction");
const { serializeLibraryManifest } = require("../../../scripts/library-core");
const { exact, fingerprint, assertAgentPatch, assertUuidV4 } = require("../../shared/agent-schema");
const { projectMetadata } = require("./metadata-projection");
const { rejectSymlinkPath } = require("./path-safety");

function sourceToken(item, registries) { return fingerprint({ item, projection: projectMetadata(item, registries).fingerprint }); }
function validateReceipt(receipt) {
  if (Buffer.byteLength(JSON.stringify(receipt)) > 8 * 1024 * 1024) throw new Error('Operation receipt exceeds 8 MiB; apply a smaller batch');
  exact(receipt, ["schemaVersion", "operationId", "libraryId", "createdAt", "expiresAt", "undoneAt", "changes"]);
  assertUuidV4(receipt.operationId); assertUuidV4(receipt.libraryId);
  const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  if (receipt.schemaVersion !== 1 || !timestamp(receipt.createdAt) || !timestamp(receipt.expiresAt) || Date.parse(receipt.expiresAt) <= Date.parse(receipt.createdAt) || receipt.undoneAt !== null && (!timestamp(receipt.undoneAt) || Date.parse(receipt.undoneAt) < Date.parse(receipt.createdAt)) || !Array.isArray(receipt.changes) || !receipt.changes.length || receipt.changes.length > 500) throw new Error("Invalid operation receipt");
  const seen = new Set();
  for (const change of receipt.changes) {
    exact(change, ["mediaId", "before", "after"]); assertUuidV4(change.mediaId);
    if (seen.has(change.mediaId)) throw new Error("Duplicate receipt media"); seen.add(change.mediaId);
    assertAgentPatch(change.before); assertAgentPatch(change.after);
    if (!Object.keys(change.before).length || Object.keys(change.before).sort().join() !== Object.keys(change.after).sort().join()) throw new Error("Invalid receipt fields");
  }
  return receipt;
}

function createOperationStore({ getLibrary, getMetadata, getRegistries, prepareWrite, publish, coordinator, getRetentionDays = () => 30 }) {
  async function list() {
    const library = getLibrary();
    await rejectSymlinkPath(library.paths.agentOperationsDir, { allowMissing: true });
    const entries = await fs.readdir(library.paths.agentOperationsDir, { withFileTypes: true }).catch(error => { if (error.code === "ENOENT") return []; throw error; });
    const receipts = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9-]{36}\.json$/.test(entry.name)) throw new Error("Invalid operation receipt entry");
      const receipt = validateReceipt(JSON.parse(await fs.readFile(path.join(library.paths.agentOperationsDir, entry.name), "utf8")));
      if (receipt.operationId + ".json" !== entry.name || receipt.libraryId !== library.manifest.libraryId) throw new Error("Operation identity mismatch");
      if (Date.parse(receipt.expiresAt) > Date.now()) receipts.push(receipt);
    }
    return receipts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function commit({ operationId = crypto.randomUUID(), changes }) {
    assertUuidV4(operationId);
    if (!Array.isArray(changes) || !changes.length || changes.length > 500) throw new Error("Select between 1 and 500 media changes");
    const session = getLibrary().sessionId;
    return coordinator.run(async () => {
      const library = getLibrary(); if (library.sessionId !== session) throw new Error("Library session changed");
      const file = path.join(library.paths.agentOperationsDir, operationId + ".json");
      await rejectSymlinkPath(file, { allowMissing: true });
      try { const receipt = validateReceipt(JSON.parse(await fs.readFile(file, "utf8"))); if (receipt.libraryId !== library.manifest.libraryId) throw new Error("Operation library mismatch"); return { receipt, repeated: true }; } catch (error) { if (error.code !== "ENOENT") throw error; }
      const current = getMetadata(), next = new Map(current), registries = getRegistries(), seen = new Set(), stored = [];
      for (const change of changes) {
        exact(change, ["mediaId", "expectedSourceToken", "patch"]); assertUuidV4(change.mediaId); assertAgentPatch(change.patch, registries.tags);
        if (seen.has(change.mediaId)) throw new Error("Duplicate media change"); seen.add(change.mediaId);
        const item = current.get(change.mediaId);
        if (!item || sourceToken(item, registries) !== change.expectedSourceToken) throw new Error("Metadata changed since review; refresh the proposal");
        const before = {}, after = {};
        for (const [field, value] of Object.entries(change.patch)) if (fingerprint(item.Customization[field]) !== fingerprint(value)) { before[field] = structuredClone(item.Customization[field]); after[field] = structuredClone(value); }
        if (!Object.keys(after).length) continue;
        next.set(item.MediaId, { ...item, Customization: { ...item.Customization, ...after, MetadataUpdateDate: new Date().toISOString() } });
        stored.push({ mediaId: item.MediaId, before, after });
      }
      if (!stored.length) throw new Error("No changed fields selected");
      const receipt = { schemaVersion: 1, operationId, libraryId: library.manifest.libraryId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + getRetentionDays() * 86400000).toISOString(), undoneAt: null, changes: stored };
      validateReceipt(receipt);
      await prepareWrite("agent-apply", { immediate: true });
      const manifest = { ...library.manifest, updatedAt: new Date().toISOString() };
      await commitTextTransaction(library.paths, [{ filePath: library.paths.metadataFile, text: serializeJsonl([...next.values()]) }, { filePath: file, text: JSON.stringify(receipt) }, { filePath: library.paths.manifestFile, text: serializeLibraryManifest(manifest) }], { reason: "agent-apply" });
      library.manifest = manifest;
      publish(next);
      return { receipt, items: stored.map(change => next.get(change.mediaId)) };
    });
  }
  async function undo(operationId) {
    assertUuidV4(operationId); const session = getLibrary().sessionId;
    return coordinator.run(async () => {
      const library = getLibrary(); if (library.sessionId !== session) throw new Error("Library session changed");
      const file = path.join(library.paths.agentOperationsDir, operationId + ".json");
      await rejectSymlinkPath(file);
      const receipt = validateReceipt(JSON.parse(await fs.readFile(file, "utf8")));
      if (receipt.libraryId !== library.manifest.libraryId || Date.parse(receipt.expiresAt) <= Date.now()) throw new Error("Operation has expired or belongs to another library");
      if (receipt.undoneAt) return { receipt, repeated: true };
      const next = new Map(getMetadata()), registries = getRegistries();
      for (const change of receipt.changes) {
        const item = next.get(change.mediaId); if (!item) throw new Error("Undo conflict: media no longer exists");
        assertAgentPatch(change.before, registries.tags);
        for (const [field, value] of Object.entries(change.after)) if (fingerprint(item.Customization[field]) !== fingerprint(value)) throw new Error("Undo conflict: an affected field has changed");
        next.set(item.MediaId, { ...item, Customization: { ...item.Customization, ...change.before, MetadataUpdateDate: new Date().toISOString() } });
      }
      const undone = { ...receipt, undoneAt: new Date().toISOString() };
      await prepareWrite("agent-undo", { immediate: true });
      const manifest = { ...library.manifest, updatedAt: new Date().toISOString() };
      await commitTextTransaction(library.paths, [{ filePath: library.paths.metadataFile, text: serializeJsonl([...next.values()]) }, { filePath: file, text: JSON.stringify(undone) }, { filePath: library.paths.manifestFile, text: serializeLibraryManifest(manifest) }], { reason: "agent-undo" });
      library.manifest = manifest;
      publish(next); return { receipt: undone, items: receipt.changes.map(change => next.get(change.mediaId)) };
    });
  }
  return { list, commit, undo };
}
module.exports = { createOperationStore, sourceToken, validateReceipt };
