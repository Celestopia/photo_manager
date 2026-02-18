/**
 * Integrity verification script.
 *
 * For each current image file:
 * - rebuild hash from disk
 * - compare with JSONL record
 * - print missing/tampered diagnostics
 */
const path = require("node:path");
const { resolveConfig, absFromConfig, walkFiles, buildMetadata, loadExisting, extensionType } = require("./common");

/**

 * Verify metadata integrity by recomputing hashes from disk files.

 * Reports missing records and tampered content without modifying metadata.

 */

async function run() {
  const config = resolveConfig();
  const root = absFromConfig(config, config.workspaceRoot);
  const metadataFile = absFromConfig(config, config.metadataFile);

  const existing = await loadExisting(metadataFile);
  const files = await walkFiles(root);
  const imageFiles = files.filter((f) => extensionType(path.extname(f)) === "image");

  let tampered = 0;

  for (const absFile of imageFiles) {
    // Recompute live metadata for comparison.
    const built = await buildMetadata(absFile, root);
    if (!built) continue;

    const current = existing.get(built.FilePath);
    if (!current) {
      console.warn(`[MISSING] ${built.FilePath} does not exist in metadata file.`);
      continue;
    }

    if (current.SHA256Hash !== built.SHA256Hash) {
      // Hash mismatch means content changed since metadata snapshot.
      tampered += 1;
      console.warn(`[TAMPERED] ${built.FilePath}`);
    }
  }

  console.log(`Verify done. Tampered files: ${tampered}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
