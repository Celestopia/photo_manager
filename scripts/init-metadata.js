/**
 * Full initialization script.
 *
 * Behavior:
 * - Scan workspace recursively.
 * - Build metadata for supported files.
 * - Keep image records in v1.
 * - Rewrite metadata JSONL from scratch.
 */
const path = require("node:path");
const { resolveConfig, absFromConfig, walkFiles, buildMetadata, writeAll, extensionType } = require("./common");

/**

 * Initialize metadata from scratch for all supported files in workspace.

 * Current UI consumes image records, so non-image items are skipped.

 */

async function run() {
  // Resolve runtime paths from config.
  const config = resolveConfig();
  const root = absFromConfig(config, config.workspaceRoot);
  const metadataFile = absFromConfig(config, config.metadataFile);

  const files = await walkFiles(root);
  // Keep only recognized media extensions, then filter to image metadata below.
  const imageOrVideo = files.filter((f) => extensionType(path.extname(f)));

  const entries = [];
  for (const file of imageOrVideo) {
    try {
      const data = await buildMetadata(file, root);
      // v1 UI only consumes image records.
      if (data && data.FileSystem.FileType === "image") entries.push(data);
    } catch (error) {
      console.error(`Skip file: ${file} (${error.message})`);
    }
  }

  await writeAll(metadataFile, entries);
  console.log(`Initialized metadata: ${entries.length} images`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
