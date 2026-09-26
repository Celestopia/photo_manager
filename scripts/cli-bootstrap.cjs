// Embedded in the Node single-executable application. Dependencies stay beside it.
const path = require('node:path');
const { createRequire } = require('node:module');
const resources = path.join(path.dirname(process.execPath), 'resources');
process.env.PHOTO_MANAGER_RESOURCE_ROOT = resources;
const requireApp = createRequire(path.join(resources, 'app', 'package.json'));
requireApp('./src/cli/main.js').main(process.argv.slice(2)).catch(error => {
  console.error(error.message); process.exitCode = 1;
});
