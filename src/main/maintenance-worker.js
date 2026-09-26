/** Child-process entry used by Electron for long-running library operations. */
const { resolveLibraryPaths } = require("../core/library-core");

const OPERATIONS = {
  initialize: () => require("../core/init-metadata").run,
  update: () => require("../core/update-metadata").run,
  verify: () => require("../core/verify-metadata").run,
  thumbnails: () => require("../core/build-thumbnails").run,
  "video-covers": () => require("../core/build-video-covers").run,
  export: () => require("../core/export-metadata-csv").run,
};

const controller = new AbortController();
process.on("message", message => { if (message?.type === "cancel") controller.abort(); });

async function main() {
  const operation = process.argv[2];
  const root = process.argv[3];
  const serializedOptions = process.argv[4] || "{}";
  if (!OPERATIONS[operation]) throw new Error(`Unknown maintenance operation: ${operation}`);
  const options = JSON.parse(serializedOptions);
  const run = OPERATIONS[operation]();
  const result = await run({
    ...options,
    paths: resolveLibraryPaths(root),
    parentSessionId: process.env.PHOTO_MANAGER_LIBRARY_SESSION || "",
    signal: controller.signal,
    onProgress: message => process.send?.(message),
    logger: {
      // createOperationReporter already emits structured IPC messages. Keep its
      // secondary sink quiet so warnings are not duplicated in UI and logs.
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  });
  if (typeof process.send === "function") {
    await new Promise((resolve) => process.send({ type: "result", result }, resolve));
  }
}

main().then(() => {
  process.exitCode = 0;
  process.disconnect?.();
}).catch(async (error) => {
  const message = {
    type: "failure",
    error: { message: error.message, code: error.code || "OPERATION_FAILED", stack: error.stack },
  };
  if (typeof process.send === "function") await new Promise((resolve) => process.send(message, resolve));
  process.exitCode = 1;
  process.disconnect?.();
});
