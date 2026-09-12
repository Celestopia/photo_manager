/** Prevent two windows from opening roots that represent the same LibraryId. */
function createLibraryClaimRegistry() {
  const claims = new Map();

  function claim(session, manifest, root) {
    const existing = claims.get(manifest.libraryId);
    if (existing && existing.session !== session) {
      const error = new Error(`Library is already open in another PhotoManager window: ${existing.root}`);
      error.code = "LIBRARY_LOCKED";
      error.lockState = {
        exists: true,
        active: true,
        sameHost: true,
        forceAllowed: false,
        lock: existing.session.runtime.activeLibrary?.lock || null,
      };
      throw error;
    }
    claims.set(manifest.libraryId, { session, root });
    session.claimedLibraryId = manifest.libraryId;
  }

  function release(session) {
    const libraryId = session.claimedLibraryId;
    if (!libraryId) return false;
    const released = claims.get(libraryId)?.session === session && claims.delete(libraryId);
    session.claimedLibraryId = null;
    return released;
  }

  return { claim, release };
}

module.exports = { createLibraryClaimRegistry };
