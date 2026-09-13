const {
  commitTextTransaction,
  serializeJsonl,
} = require("../../../scripts/library-transaction");
const {
  assertCustomizationPatch,
} = require("../../shared/customization-schema");
/** Caller holds the library mutation queue, then the chat session queue. */
function createMetadataCommit({
  getLibrary,
  getIndex,
  getTags,
  prepareWrite,
  metadataFile,
  enrich,
  touchManifest,
  commitTransaction = commitTextTransaction,
}) {
  return async (proposal, session, store) => {
    const library = getLibrary({ writable: true });
    const index = getIndex(),
      current = index.get(proposal.mediaId);
    if (!current) throw new Error("Media unavailable");
    const patch = { [proposal.field]: proposal.after };
    assertCustomizationPatch(patch, ["Title", "Description", "TagIds"]);
    if (
      proposal.field === "TagIds" &&
      proposal.after.some((id) => !getTags().has(id))
    )
      throw new Error("Unregistered tag");
    const item = structuredClone(current);
    Object.assign(item.Customization, patch, {
      MetadataUpdateDate: new Date().toISOString(),
    });
    const next = new Map(index);
    next.set(item.MediaId, item);
    await prepareWrite("agent-metadata-review", { immediate: true });
    const sessionChange = await store.stage(session);
    await commitTransaction(
      library.paths,
      [
        { filePath: metadataFile(), text: serializeJsonl(next.values()) },
        sessionChange,
      ],
      { reason: "agent-metadata-review" },
    );
    index.set(item.MediaId, item);
    await touchManifest();
    return enrich(item);
  };
}
module.exports = { createMetadataCommit };
