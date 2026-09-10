const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createLibraryWriteCoordinator } = require("../src/main/library-write-coordinator");
const { projectMetadata } = require("../src/main/agent/metadata-projection");
const { validateProviders, DEFAULT_PROVIDERS } = require("../src/main/agent/provider-config");
const { createOperationStore, sourceToken } = require("../src/main/agent/operation-store");
const { resolveLibraryPaths, createLibraryManifest } = require("../scripts/library-core");
const { createBudget } = require("../src/main/agent/budget");
const { chatCompletion } = require("../src/main/agent/providers/chat-completions");
const { evaluatePredicates } = require("../src/main/agent/retrieval-domain");
const { sampleTimes } = require("../src/main/agent/media-assets");
const registries = () => ({ tags: new Map(), people: new Map(), albums: new Map(), locations: new Map() });
function media() { return { MediaId: crypto.randomUUID(), FilePath: "image.jpg", SHA256Hash: "a".repeat(64), FileSystem: { FileType: "image", ShootingTimeString: "2025-08-01 12:00:00" }, Customization: { Title: "Before", Description: "", HiddenDescription: "", TagIds: [], PersonIds: [], AlbumId: null, Rating: 1, Privacy: 1 }, Location: { LocationId: null, Detail: "" } }; }

test("write coordinator serializes validation through publication and recovers after failure", async () => {
  const coordinator = createLibraryWriteCoordinator(), order = [];
  const first = coordinator.run(async () => { order.push("first"); await new Promise(resolve => setTimeout(resolve, 10)); order.push("published"); throw new Error("expected"); });
  const second = coordinator.run(() => { order.push("second"); });
  await assert.rejects(first, /expected/); await second; await coordinator.drain();
  assert.deepEqual(order, ["first", "published", "second"]); assert.equal(coordinator.busy, false);
});
test("local projection incorporates registry edits and hidden metadata without changing pixel identity", () => {
  const item = media(), registry = registries(), tagId = crypto.randomUUID(); item.Customization.TagIds = [tagId];
  registry.tags.set(tagId, { TagId: tagId, Text: "sea", Description: "coast" });
  const before = projectMetadata(item, registry); item.Customization.HiddenDescription = "private memory";
  assert.notEqual(projectMetadata(item, registry).fingerprint, before.fingerprint);
  registry.tags.get(tagId).Description = "ocean";
  assert.match(projectMetadata(item, registry).description, /ocean/); assert.equal(item.SHA256Hash, "a".repeat(64));
});
test("embedding profiles reject remote endpoint substitution and insecure public chat URLs", () => {
  const remote = structuredClone(DEFAULT_PROVIDERS); remote.profiles["local-clip"].baseUrl = "https://example.com";
  assert.throws(() => validateProviders(remote), /pinned/);
  const insecure = structuredClone(DEFAULT_PROVIDERS); insecure.profiles["qwen-vlm"].baseUrl = "http://example.com/v1";
  assert.throws(() => validateProviders(insecure), /URL/);
});
test("reviewed edits and receipts commit together; undo preserves unrelated fields and rejects conflicts", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pm-agent-")); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const paths = resolveLibraryPaths(root), registry = registries(), item = media();
  await fs.mkdir(paths.dataDir, { recursive: true }); await fs.writeFile(paths.metadataFile, JSON.stringify(item) + "\n");
  let metadata = new Map([[item.MediaId, item]]);
  const library = { paths, sessionId: crypto.randomUUID(), manifest: createLibraryManifest('Test library') };
  const store = createOperationStore({ getLibrary: () => library, getMetadata: () => metadata, getRegistries: () => registry, prepareWrite: async () => {}, publish: next => { metadata = next; }, coordinator: createLibraryWriteCoordinator() });
  const operationId = crypto.randomUUID(), change = { mediaId: item.MediaId, expectedSourceToken: sourceToken(item, registry), patch: { Title: "After" } };
  await store.commit({ operationId, changes: [change] });
  assert.equal(metadata.get(item.MediaId).Customization.Title, "After");
  assert.equal((await store.commit({ operationId, changes: [change] })).repeated, true);
  metadata.get(item.MediaId).Customization.Rating = 5;
  await store.undo(operationId);
  assert.equal(metadata.get(item.MediaId).Customization.Title, "Before"); assert.equal(metadata.get(item.MediaId).Customization.Rating, 5);
  await assert.rejects(store.commit({ changes: [change] }), /changed since review/);
  const nextId = crypto.randomUUID(); await store.commit({ operationId: nextId, changes: [{ ...change, expectedSourceToken: sourceToken(metadata.get(item.MediaId), registry) }] });
  metadata.get(item.MediaId).Customization.Title = "Manual";
  await assert.rejects(store.undo(nextId), /conflict/); assert.equal(metadata.get(item.MediaId).Customization.Title, "Manual");
});
test("failed backup publishes neither proposed metadata nor receipt", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pm-agent-")); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const item = media(), registry = registries(), metadata = new Map([[item.MediaId, item]]), paths = resolveLibraryPaths(root);
  const store = createOperationStore({ getLibrary: () => ({ paths, sessionId: "session", manifest: { libraryId: crypto.randomUUID() } }), getMetadata: () => metadata, getRegistries: () => registry,
    prepareWrite: async () => { throw new Error("backup failed"); }, publish: () => assert.fail("must not publish"), coordinator: createLibraryWriteCoordinator() });
  await assert.rejects(store.commit({ changes: [{ mediaId: item.MediaId, expectedSourceToken: sourceToken(item, registry), patch: { Title: "Changed" } }] }), /backup failed/);
  assert.equal(item.Customization.Title, "Before");
});
test("incomplete streamed tool arguments never return an executable tool call", async () => {
  const fetcher = async () => new Response('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"x","function":{"name":"propose_metadata","arguments":"{"}}]}}]}\n\n', { status: 200 });
  const profile = { ...DEFAULT_PROVIDERS.profiles["qwen-vlm"], baseUrl: "https://example.com/v1" };
  await assert.rejects(chatCompletion(profile, { messages: [{ role: "user", content: "Test" }], budget: createBudget("viewer") }, fetcher), /before completion/);
});
test("ordinary date keeps unknowns but strict date excludes them; known contradictions are excluded", () => {
  const item = media(), registry = registries();
  const plan = { predicates: { all: [{ field: "date", value: "2025-08", policy: "ordinary", operator: "eq", source: "August 2025" }] } };
  assert.equal(evaluatePredicates(item, plan, registry).excluded, false);
  item.FileSystem.ShootingTimeString = "2024-08-01"; assert.equal(evaluatePredicates(item, plan, registry).excluded, true);
  item.FileSystem.ShootingTimeString = null; assert.equal(evaluatePredicates(item, plan, registry).unknown, true);
  plan.predicates.all[0].policy = "required"; assert.equal(evaluatePredicates(item, plan, registry).excluded, true);
});
test("video sampling is bounded and includes both ends", () => {
  assert.equal(sampleTimes(60).length, 5); assert.equal(sampleTimes(300).length, 21); assert.equal(sampleTimes(1800).length, 120);
  assert.equal(sampleTimes(60)[0], 0); assert.equal(sampleTimes(60).at(-1), 59.9); assert.throws(() => sampleTimes(1801), /30 minutes/);
});
test("preferred predicates cannot bypass a required branch of an OR", () => {
  const { validateTree, evaluateTree } = require('../src/main/agent/query-predicates');
  const tree = { any: [{ field: 'date', operator: 'eq', value: '2024', policy: 'required', source: '2024' }, { field: 'rating', operator: 'eq', value: 1, policy: 'preferred', source: 'prefer one star' }] };
  validateTree(tree); assert.equal(evaluateTree(media(), tree, registries()).excluded, true);
  assert.throws(() => validateTree({ all: [{ ...tree.any[0], value: '2025-02-30' }] }), /calendar date/);
});
test("metadata tools enforce approved groups and expose only the selected record", () => {
  const { createToolRouter } = require('../src/main/agent/tool-router');
  const item = media(); item.Customization.HiddenDescription = 'SECRET';
  const read = createToolRouter({ item, registries: registries(), approvedGroups: ['basic'], tagCatalogue: false });
  assert.throws(() => read('get_media_metadata', { group: 'hidden', offset: 0, limit: 100 }), /not approved/);
  assert.throws(() => read('search_registries', { query: '', offset: 0, limit: 10 }), /not approved/);
  assert.throws(() => read('get_media_metadata', { group: 'basic', offset: 0, limit: 100, mediaId: crypto.randomUUID() }), /unsupported/);
  assert.doesNotMatch(JSON.stringify(read('get_media_metadata', { group: 'basic', offset: 0, limit: 4000 })), /SECRET/);
});
test("a fake local VLM receives only approved metadata; viewer saves record only accepted agent fields", async t => {
  const http = require('node:http'), yaml = require('js-yaml'), sharp = require('sharp');
  const { createAgentService } = require('../src/main/agent/agent-service');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-agent-chat-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const paths = resolveLibraryPaths(root), item = media(), registry = registries();
  const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#0055aa' } }).png().toBuffer();
  await fs.writeFile(path.join(root, item.FilePath), image); const stat = await fs.stat(path.join(root, item.FilePath));
  Object.assign(item.FileSystem, { FileSize: stat.size, ModificationTimeMs: stat.mtimeMs });
  item.Customization.HiddenDescription = 'DO_NOT_SEND_PRIVATE_DESCRIPTION';
  let captured = '', denied = false;
  const server = http.createServer(async (request, response) => {
    for await (const chunk of request) captured += chunk;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const name = denied ? 'get_media_metadata' : 'propose_metadata';
    const args = denied ? { group: 'hidden', offset: 0, limit: 100 } : { Title: 'Reviewed title' };
    response.end('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const config = structuredClone(DEFAULT_PROVIDERS); config.profiles['qwen-vlm'].baseUrl = `http://127.0.0.1:${server.address().port}/v1`; config.profiles['qwen-vlm'].model = 'fake-vlm';
  const configFile = path.join(root, 'agent-providers.yml'); await fs.writeFile(configFile, yaml.dump(config));
  let metadata = new Map([[item.MediaId, item]]);
  const library = { paths, sessionId: crypto.randomUUID(), manifest: createLibraryManifest('Test library') };
  const agent = createAgentService({ applicationPaths: { agentProviderFile: configFile, agentModelsDir: path.join(root, 'models') }, getLibrary: () => library, getMetadata: () => metadata, getRegistries: () => registry, queryScope: () => [...metadata.values()],
    coordinator: createLibraryWriteCoordinator(), prepareWrite: async () => {}, publish: next => { metadata = next; }, getMediaConfig: () => ({}), enrichItem: item => item });
  t.after(() => agent.dispose()); await agent.initialize();
  const payload = { query: 'Suggest a title', mediaIds: [item.MediaId], groups: ['basic'], tagCatalogue: false, propose: true, replaceTags: false };
  payload.approvalId = agent.preview({ mediaIds: payload.mediaIds, groups: payload.groups, tagCatalogue: false }).approvalId;
  const result = await agent.chat(payload), originalProposal = result.results[0].proposals[0];
  await assert.rejects(agent.chat(payload), /approval|preview/i);
  assert.throws(() => agent.revise({ proposalId: originalProposal.proposalId, patch: { Description: 'Different field' } }), /field set/);
  const proposal = agent.revise({ proposalId: originalProposal.proposalId, patch: { Title: 'User reviewed title' } });
  assert.notEqual(proposal.proposalId, originalProposal.proposalId);
  assert.throws(() => agent.revise({ proposalId: originalProposal.proposalId, patch: originalProposal.patch }), /expired/);
  assert.match(captured, /data:image\/jpeg;base64,/); assert.doesNotMatch(captured, /DO_NOT_SEND_PRIVATE_DESCRIPTION/);
  assert.equal(metadata.get(item.MediaId).Customization.Title, 'Before');
  const next = new Map(metadata); next.set(item.MediaId, { ...item, Customization: { ...item.Customization, Title: 'User reviewed title', Rating: 5 } });
  await agent.saveReviewedDraft(next, { mediaId: item.MediaId, expectedSourceToken: proposal.expectedSourceToken, agentSelections: [{ proposalId: proposal.proposalId, fields: ['Title'] }] });
  const [receipt] = await agent.operations.list(); assert.deepEqual(receipt.changes[0].after, { Title: 'User reviewed title' }); assert.equal(metadata.get(item.MediaId).Customization.Rating, 5);
  denied = true; captured = '';
  payload.approvalId = agent.preview({ mediaIds: payload.mediaIds, groups: payload.groups, tagCatalogue: false }).approvalId;
  await assert.rejects(agent.chat(payload), /not approved/); assert.doesNotMatch(captured, /DO_NOT_SEND_PRIVATE_DESCRIPTION/);
});
test("video derivatives preserve sample aspect ratio and report decoded timestamps", async t => {
  const { mediaFrames } = require('../src/main/agent/media-assets');
  const { resolveMediaToolPaths } = require('../scripts/media-tools');
  const { DEFAULT_CONFIG } = require('../scripts/application-config');
  const resourceRoot = path.resolve(__dirname, '..'), { ffmpegPath } = resolveMediaToolPaths(resourceRoot, DEFAULT_CONFIG.media);
  if (!require('node:fs').existsSync(ffmpegPath)) return t.skip('Bundled FFmpeg is required');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-agent-video-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'sample.mp4');
  await require('node:util').promisify(require('node:child_process').execFile)(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x24:r=10', '-t', '1', '-vf', 'setsar=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file], { windowsHide: true, timeout: 30000 });
  const stat = await fs.stat(file), item = media(); item.FilePath = 'sample.mp4'; item.FileSystem = { FileType: 'video', FileSize: stat.size, ModificationTimeMs: stat.mtimeMs }; item.Video = { DurationSeconds: 1 };
  const frames = []; for await (const frame of mediaFrames(resolveLibraryPaths(root), item, { resourceRoot, mediaConfig: DEFAULT_CONFIG.media })) frames.push(frame);
  assert.equal(frames.length, 2); assert.ok(frames.every(frame => !frame.error));
  assert.equal(frames[0].timestamp, 0); assert.ok(frames[1].timestamp >= 0.9);
  const info = await require('sharp')(frames[0].image).metadata(); assert.equal(info.width / info.height, 64 / 24);
});
