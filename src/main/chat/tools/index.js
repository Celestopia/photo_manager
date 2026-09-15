const { createToolRegistry } = require('./registry');
const definitions = [...require('./metadata').definitions, ...require('./web').definitions];
const tools = createToolRegistry(definitions);
module.exports = { definitions, tools };
