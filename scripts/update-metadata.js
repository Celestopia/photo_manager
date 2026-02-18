/**
 * Incremental metadata sync script.
 *
 * Strategy:
 * 1) Re-scan workspace and rebuild latest file metadata.
 * 2) Preserve Customization/Location from existing metadata whenever possible.
 * 3) Use SHA256 to carry Customization across file moves/renames.
 * 4) Rewrite JSONL as the current truth snapshot.
 */
const path = require("node:path");
const { resolveConfig, absFromConfig, walkFiles, buildMetadata, loadExisting, writeAll, extensionType } = require("./common");

/**

 * Incrementally rebuild metadata while preserving user-authored fields.

 * Supports move/rename continuity by matching records through SHA256 hash.

 */

async function run() {
  const config = resolveConfig();
  const root = absFromConfig(config, config.workspaceRoot);
  const metadataFile = absFromConfig(config, config.metadataFile);

  const existing = await loadExisting(metadataFile);
  const files = await walkFiles(root);
  const imageFiles = files.filter((f) => extensionType(path.extname(f)) === "image");

  const byHash = new Map();
  // Secondary index used to detect moved files with same content hash.
  for (const item of existing.values()) byHash.set(item.SHA256Hash, item);

  const next = new Map();

  for (const absFile of imageFiles) {
    try {
      const built = await buildMetadata(absFile, root);
      if (!built) continue;

      const oldDirect = existing.get(built.FilePath);
      // Prefer direct FilePath hit, otherwise fallback to hash-based move tracking.
      if (oldDirect) {
        built.Customization = oldDirect.Customization || built.Customization;
        built.Location = { ...(built.Location || {}), ...(oldDirect.Location || {}) };
      } else if (byHash.has(built.SHA256Hash)) {
        const oldByHash = byHash.get(built.SHA256Hash);
        built.Customization = oldByHash.Customization || built.Customization;
        built.Location = { ...(built.Location || {}), ...(oldByHash.Location || {}) };
      }
      if (built.Customization && Object.prototype.hasOwnProperty.call(built.Customization, "Category")) {
        delete built.Customization.Category;
      }

      next.set(built.FilePath, built);
    } catch (error) {
      console.error(`Skip file: ${absFile} (${error.message})`);
    }
  }

  await writeAll(metadataFile, [...next.values()]);
  console.log(`Updated metadata: ${next.size} images`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
