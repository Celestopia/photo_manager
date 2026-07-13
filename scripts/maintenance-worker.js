/** Child-process entry used by Electron for long-running library operations. */
const { resolveLibraryPaths } = require("./library-core");

const OPERATIONS = {
  initialize: () => require("./init-metadata").run,
  update: () => require("./update-metadata").run,
  verify: () => require("./verify-metadata").run,
  thumbnails: () => require("./build-thumbnails").run,
  export: () => require("./export-metadata-csv").run,
};

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
