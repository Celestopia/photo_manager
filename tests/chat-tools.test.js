const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const sharp = require("sharp");
const yaml = require("js-yaml");
const { resolveLibraryPaths } = require("../scripts/library-core");
const provider = require("../src/main/chat/provider");
const { createChatService } = require("../src/main/chat/service");
const { createMetadataCommit } = require("../src/main/chat/metadata-commit");
const {
  createMutationCoordinator,
} = require("../src/main/mutation-coordinator");
const { createStore } = require("../src/main/chat/store");
const { defaultGroups } = require("../src/main/chat/schema");
const { runAgent } = require("../src/main/chat/agent-loop");
const { createBudget, transition } = require("../src/main/chat/runtime");
const { createToolRegistry } = require("../src/main/chat/tools/registry");
const { metadataTools } = require("../src/main/chat/tools/metadata");
const usage = {
  inputCacheHit: 0,
  inputCacheMiss: 10,
  inputTotal: 10,
  output: 3,
};
const event = (value) => "data: " + JSON.stringify(value) + "\n\n";
function reply(text = "Done", calls = []) {
  return new Response(
    event({
      choices: [
        {
          delta: {
            content: text,
            tool_calls: calls.map((c, index) => ({
              index,
              id: c.id || "call_" + index,
              type: "function",
              function: { name: c.name, arguments: JSON.stringify(c.args) },
            })),
          },
        },
      ],
    }) +
      event({
        choices: [
          { delta: {}, finish_reason: calls.length ? "tool_calls" : "stop" },
        ],
      }) +
      event({
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      }) +
      "data: [DONE]\n\n",
  );
}
async function fixture(t, respond, searchFetchImpl) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "photo-manager-agent-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const paths = resolveLibraryPaths(root),
    library = { paths, manifest: { libraryId: randomUUID() } };
  await fs.mkdir(paths.managerDir, { recursive: true });
  const id = randomUUID(),
    tagId = randomUUID(),
    otherTag = randomUUID();
  const file = path.join(root, "photo.png");
  await sharp({
    create: { width: 16, height: 12, channels: 3, background: "red" },
  })
    .png()
    .toFile(file);
  const item = {
    MediaId: id,
    FilePath: "photo.png",
    FileSystem: { FileType: "image" },
    Customization: {
      Title: "Original",
      Description: "Saved",
      TagIds: [tagId],
      MetadataUpdateDate: null,
    },
  };
  const index = new Map([[id, item]]),
    tags = new Map([
      [tagId, { TagId: tagId, Text: "夜景", Description: "Night" }],
      [
        otherTag,
        { TagId: otherTag, Text: "Architecture", Description: "Buildings" },
      ],
    ]);
  const metadataFile = path.join(paths.managerDir, "metadata.jsonl");
  await fs.writeFile(metadataFile, JSON.stringify(item) + "\n");
  const configFile = path.join(root, "provider.yml");
  await fs.writeFile(
    configFile,
    yaml.dump({ ...provider.DEFAULT, baseUrl: "https://example.com/v1" }),
  );
  let backupFailure = false,
    backups = 0,
    transactionFailure = false;
  const commit = createMetadataCommit({
    getLibrary: () => library,
    getIndex: () => index,
    getTags: () => tags,
    metadataFile: () => metadataFile,
    prepareWrite: async () => {
      backups++;
      if (backupFailure) throw new Error("Backup failed");
    },
    enrich: (v) => v,
    touchManifest: async () => {},
    commitTransaction: (paths, changes, options) =>
      require("../scripts/library-transaction").commitTextTransaction(
        paths,
        changes,
        {
          ...options,
          beforeApply: async (index) => {
            if (transactionFailure && index === 1)
              throw new Error("Injected session write failure");
          },
        },
      ),
  });
  const requests = [];
  const searchConfigFile = path.join(root, 'search.yml');
  if (searchFetchImpl) await fs.writeFile(searchConfigFile, yaml.dump({ schemaVersion: 1, provider: 'tavily', apiKey: 'test-only', apiKeyEnv: '' }));
  const ctx = { id, tagId, otherTag, index, tags, requests };
  const chat = createChatService({
    getLibrary: () => library,
    resolveMedia: (mid) => {
      const item = index.get(mid);
      if (!item) throw new Error("Missing");
      return { item, absolutePath: file };
    },
    getMetadata: (mid, g) =>
      g.basic
        ? {
            title: index.get(mid).Customization.Title,
            description: index.get(mid).Customization.Description,
            tags: index
              .get(mid)
              .Customization.TagIds.map((id) => tags.get(id).Text),
          }
        : {},
    configFile,
    searchConfigFile,
    searchFetchImpl,
    getMediaToolPaths: () => ({}),
    tags: () => [...tags.values()],
    commitMetadata: commit,
    mutate: createMutationCoordinator(),
    emit: () => {},
    fetchImpl: async (_, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return respond ? respond(body, ctx) : reply();
    },
  });
  t.after(() => chat.close());
  const session = await chat.create();
  async function send(
    text = "Suggest metadata",
    inputs = [{ kind: "media", id, mode: "optimized" }],
    groups = defaultGroups(),
    webEnabled = false,
  ) {
    await chat.send({
      sessionId: session.sessionId,
      text,
      inputs,
      groups,
      excludeInputs: [],
      webEnabled,
      retryOf: null,
    });
    for (let n = 0; chat.isBusy() && n < 500; n++)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(chat.isBusy(), false, "run finishes");
    return chat.load(session.sessionId);
  }
  return {
    ...ctx,
    root,
    library,
    file,
    metadataFile,
    chat,
    session,
    send,
    store: createStore(library),
    backupFail: () => {
      backupFailure = true;
    },
    transactionFail: () => {
      transactionFailure = true;
    },
    backups: () => backups,
  };
}

test('web research can produce an existing-tag lookup and a reviewed metadata change in one serial turn', async t => {
  let active = 0, maxActive = 0, webCalls = 0;
  const f = await fixture(t, (body, ctx) => {
    const outcomes = body.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
    if (!outcomes.length) return reply('', [{ name: 'web_search', args: { query: 'Eiffel Tower' } }]);
    const source = outcomes[0].sources[0];
    if (outcomes.length === 1) return reply('', [{ name: 'read_web_page', args: { sourceId: source.sourceId } }]);
    if (outcomes.length === 2) return reply('', [{ name: 'find_library_tags', args: { query: 'Architecture', cursor: null } }]);
    if (outcomes.length === 3) return reply('', [{ name: 'propose_title', args: { mediaId: ctx.id, title: 'Eiffel Tower in Paris' } }]);
    return reply(`Research supports this title [source:${source.sourceId}].`);
  }, async url => {
    active++; maxActive = Math.max(maxActive, active); webCalls++;
    await new Promise(r => setTimeout(r, 5)); active--;
    return new Response(JSON.stringify({ results: [url.endsWith('/search')
      ? { title: 'Tower', url: 'https://www.toureiffel.paris/en', content: 'Paris landmark' }
      : { url: 'https://www.toureiffel.paris/en', raw_content: 'The Eiffel Tower is in Paris.' }], usage: { credits: 1 } }));
  });
  const session = await f.send('Research and suggest a title', undefined, undefined, true);
  assert.equal(maxActive, 1); assert.equal(webCalls, 2); assert.equal(session.messages[1].status, 'complete');
  assert.equal(f.index.get(f.id).Customization.Title, 'Original');
  assert.equal(session.proposals.length, 1);
  await f.chat.decide(session.sessionId, session.proposals[0].id, 'accept');
  assert.equal(f.index.get(f.id).Customization.Title, 'Eiffel Tower in Paris');
  assert.equal((await f.store.load(session.sessionId)).proposals[0].status, 'accepted');
});

test("tool-only streaming assembles interleaved fragments and retains trailing usage", async () => {
  const data =
    event({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 1,
                id: "b",
                type: "function",
                function: { name: "propose_", arguments: '{"mediaId":' },
              },
              {
                index: 0,
                id: "a",
                type: "function",
                function: {
                  name: "find_library_tags",
                  arguments: '{"query":"夜',
                },
              },
            ],
          },
        },
      ],
    }) +
    event({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: '景","cursor":null}' } },
              {
                index: 1,
                function: { name: "title", arguments: '"x","title":"Test"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    }) +
    event({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } }) +
    "data: [DONE]\n\n";
  const bytes = Buffer.from(data);
  const result = await provider.request(
    { baseUrl: "https://example.com", model: "test" },
    [],
    {
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(c) {
              for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
              c.close();
            },
          }),
        ),
    },
  );
  assert.equal(result.text, "");
  assert.equal(result.calls[0].name, "find_library_tags");
  assert.equal(JSON.parse(result.calls[0].arguments).query, "夜景");
  assert.equal(result.calls[1].name, "propose_title");
  assert.equal(result.usage.inputTotal, 3);
  await assert.rejects(
    () =>
      provider.request({ baseUrl: "https://example.com", model: "test" }, [], {
        fetchImpl: async () =>
          new Response(
            event({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "a",
                        function: { name: "tool", arguments: "{" },
                      },
                    ],
                  },
                  finish_reason: "length",
                },
              ],
            }) + "data: [DONE]\n\n",
          ),
      }),
    /limit/,
  );
});

test("sequential lookup and three proposals persist without writes; accept is atomic and idempotent", async (t) => {
  const f = await fixture(t, (body, c) => {
    const results = body.messages.filter((m) => m.role === "tool");
    if (!results.length)
      return reply("", [
        { name: "find_library_tags", args: { query: "", cursor: null } },
      ]);
    if (results.length === 1)
      return reply("", [
        { name: "propose_title", args: { mediaId: c.id, title: "New title" } },
        {
          name: "propose_description",
          args: { mediaId: c.id, description: "New description" },
        },
        {
          name: "propose_tags",
          args: { mediaId: c.id, operation: "add", tagIds: [c.otherTag] },
        },
      ]);
    return reply("Three suggestions are ready for review.");
  });
  let s = await f.send();
  assert.equal(
    s.messages.at(-1).status,
    "complete",
    s.messages.at(-1).attempt.error,
  );
  assert.equal(s.proposals.length, 3);
  assert.equal(f.requests.length, 3);
  assert.equal(f.index.get(f.id).Customization.Title, "Original");
  assert.equal(f.backups(), 0);
  assert.ok(
    f.requests.every(
      (r) => !r.tools?.some((t) => t.function.name === "web_search"),
    ),
  );
  const p = s.proposals.find((p) => p.field === "Title");
  const result = await f.chat.decide(s.sessionId, p.id, "accept");
  assert.equal(result.item.Customization.Title, "New title");
  assert.equal(f.backups(), 1);
  assert.equal(
    JSON.parse((await fs.readFile(f.metadataFile, "utf8")).trim()).Customization
      .Title,
    "New title",
  );
  assert.equal(
    (await f.store.load(s.sessionId)).proposals.find((v) => v.id === p.id)
      .status,
    "accepted",
  );
  await f.chat.decide(s.sessionId, p.id, "accept");
  assert.equal(f.backups(), 1);
  s = (
    await f.chat.decide(
      s.sessionId,
      s.proposals.find((p) => p.field === "Description").id,
      "decline",
    )
  ).session;
  assert.equal(f.index.get(f.id).Customization.Description, "Saved");
  assert.equal(
    s.proposals.find((p) => p.field === "TagIds").status,
    "pending_review",
  );
  s = await f.send("Thanks", []);
  assert.equal(
    s.messages.at(-1).status,
    "complete",
    s.messages.at(-1).attempt.error,
  );
  assert.equal(
    s.messages[1].attempt.inputs[0].metadata.title,
    "Original",
    "historical snapshot stays immutable",
  );
});

test("no-op and unknown tag proposals create no card; authority cannot come from arguments", async (t) => {
  const f = await fixture(t, (body, c) =>
    body.messages.some((m) => m.role === "tool")
      ? reply()
      : reply("", [
          { name: "propose_title", args: { mediaId: c.id, title: "Original" } },
          {
            name: "propose_tags",
            args: { mediaId: c.id, operation: "add", tagIds: [randomUUID()] },
          },
          {
            name: "propose_description",
            args: { mediaId: randomUUID(), description: "Unrelated" },
          },
          { name: "web_search", args: { query: "secret" } },
        ]),
  );
  const s = await f.send();
  assert.equal(s.proposals.length, 0);
  assert.equal(f.backups(), 0);
  const outcomes = s.messages
    .at(-1)
    .attempt.steps.filter((v) => v.kind === "tool")
    .map((v) => v.outcome);
  assert.equal(outcomes[0].status, "no_change");
  assert.equal(outcomes[1].code, "resource_conflict");
  assert.equal(outcomes[2].code, "permission_denied");
  assert.equal(outcomes[3].code, "permission_denied");
});

test("stale proposals need a fresh explicit review and backup failure leaves disk unchanged", async (t) => {
  const f = await fixture(t, (body, c) =>
    body.messages.some((m) => m.role === "tool")
      ? reply()
      : reply("", [
          {
            name: "propose_title",
            args: { mediaId: c.id, title: "Suggested" },
          },
        ]),
  );
  let s = await f.send();
  const p = s.proposals[0];
  f.index.get(f.id).Customization.Title = "Manual";
  s = (await f.chat.decide(s.sessionId, p.id, "accept")).session;
  assert.equal(s.proposals[0].status, "stale");
  assert.equal(f.backups(), 0);
  s = (await f.chat.decide(s.sessionId, p.id, "refresh")).session;
  const fresh = s.proposals.at(-1);
  assert.equal(fresh.before, "Manual");
  assert.equal(fresh.status, "pending_review");
  f.backupFail();
  await assert.rejects(
    () => f.chat.decide(s.sessionId, fresh.id, "accept"),
    /Backup/,
  );
  assert.equal(
    (await f.store.load(s.sessionId)).proposals.at(-1).status,
    "pending_review",
  );
  assert.equal(f.index.get(f.id).Customization.Title, "Manual");
});

test("chat recovery stays within its owned storage namespace", async (t) => {
  const f = await fixture(t);
  const outside = path.join(
    f.library.paths.managerDir,
    "chat",
    "sessions",
    "old",
  );
  const trash = path.join(f.library.paths.managerDir, "chat", "trash", "old");
  await fs.mkdir(outside, { recursive: true });
  await fs.mkdir(trash, { recursive: true });
  await fs.writeFile(path.join(outside, "session.json"), "outside bytes");
  await fs.writeFile(path.join(trash, "attachment"), "keep");
  await f.store.recover();
  const opened = await f.chat.open();
  assert.deepEqual(Object.keys(opened), ["sessions"]);
  assert.equal(
    await fs.readFile(path.join(outside, "session.json"), "utf8"),
    "outside bytes",
  );
  assert.equal(
    await fs.readFile(path.join(trash, "attachment"), "utf8"),
    "keep",
  );
});

test("fake tools and an alternative normalized adapter do not require runner changes", async () => {
  let running = 0,
    maximum = 0,
    round = 0;
  const definition = {
    name: "fixture_read",
    contractVersion: 1,
    description: "Fixture",
    parameters: { type: "object" },
    available: () => true,
    validate: () => {},
    validateResult: (v) => assert.equal(v.status, "success"),
    async execute() {
      running++;
      maximum = Math.max(maximum, running);
      await new Promise((r) => setImmediate(r));
      running--;
      return { status: "success" };
    },
  };
  assert.throws(
    () => createToolRegistry([definition, definition]),
    /duplicate/,
  );
  const registry = createToolRegistry([definition]);
  const message = {
    status: "preparing",
    attempt: { steps: [], error: "", reason: "" },
  };
  const states = [];
  await runAgent({
    message,
    messages: [],
    definitions: [definition],
    executor: registry.execute,
    signal: new AbortController().signal,
    context: { scope: {}, represented: new Set(), checkLibrary() {} },
    save: async () => states.push(message.status),
    progress() {},
    complete: async () => ({
      text: round++ ? "Finished" : "",
      calls:
        round === 1
          ? [
              { providerId: "1", name: "fixture_read", arguments: "{}" },
              { providerId: "2", name: "fixture_read", arguments: "{}" },
            ]
          : [],
      finish: round === 1 ? "calls" : "stop",
      usage,
      continuation: null,
    }),
  });
  assert.equal(maximum, 1);
  assert.equal(message.status, "complete");
  assert.deepEqual(
    message.attempt.steps.map((s) => s.kind),
    ["completion", "tool", "tool", "completion"],
  );
  assert.ok(states.includes("finalizing"));
  assert.throws(
    () => transition(message, "generating"),
    /Invalid run transition/,
  );
});

test("Stop preserves finished calls and prevents later dispatch; persistence failure escapes", async () => {
  const controller = new AbortController();
  const message = {
    status: "preparing",
    attempt: { steps: [], error: "", reason: "" },
  };
  let calls = 0;
  await runAgent({
    message,
    messages: [],
    definitions: [],
    signal: controller.signal,
    save: async () => {},
    progress() {},
    context: {},
    complete: async () => ({
      text: "",
      calls: [
        { providerId: "1", name: "fixture", arguments: "{}" },
        { providerId: "2", name: "fixture", arguments: "{}" },
      ],
      finish: "calls",
      usage: null,
      continuation: null,
    }),
    executor: async () => {
      calls++;
      controller.abort();
      return { status: "no_change" };
    },
  });
  assert.equal(calls, 1);
  assert.equal(message.status, "stopped");
  assert.equal(message.attempt.steps[1].kind, "tool");
  const error = Object.assign(new Error("save"), { code: "persistence_error" });
  await assert.rejects(
    () =>
      runAgent({
        message: { status: "preparing", attempt: { steps: [] } },
        messages: [],
        definitions: [],
        context: {},
        signal: new AbortController().signal,
        save: async () => {
          throw error;
        },
      }),
    /save/,
  );
});

test("metadata availability honors sharing and executor budgets are independent of names", async () => {
  assert.deepEqual(
    metadataTools
      .available({ groups: { basic: false }, mediaIds: [randomUUID()] })
      .map((t) => t.name),
    ["propose_title", "propose_description"],
  );
  const outcome = await metadataTools.execute(
    { id: randomUUID(), name: "propose_title", arguments: "{}" },
    {
      signal: new AbortController().signal,
      budget: createBudget({ calls: 0 }),
      enabled: [],
      scope: { groups: { basic: true }, mediaIds: [] },
    },
  );
  assert.equal(outcome.code, "budget_exceeded");
});

test("failed second transaction target rolls back metadata and leaves the preview pending", async (t) => {
  const f = await fixture(t, (body, c) =>
    body.messages.some((m) => m.role === "tool")
      ? reply()
      : reply("", [
          {
            name: "propose_title",
            args: { mediaId: c.id, title: "Atomic suggestion" },
          },
        ]),
  );
  const s = await f.send();
  const before = await fs.readFile(f.metadataFile, "utf8");
  const history = await fs.readFile(await f.store.file(s.sessionId), "utf8");
  f.transactionFail();
  await assert.rejects(
    () => f.chat.decide(s.sessionId, s.proposals[0].id, "accept"),
    /Injected/,
  );
  assert.equal(await fs.readFile(f.metadataFile, "utf8"), before);
  assert.equal(
    await fs.readFile(await f.store.file(s.sessionId), "utf8"),
    history,
  );
  assert.equal(f.index.get(f.id).Customization.Title, "Original");
  await assert.rejects(() => fs.access(f.library.paths.transactionFile), {
    code: "ENOENT",
  });
});

test("tag rename invalidates a preview and strict history rejects forged proposal origins", async (t) => {
  const f = await fixture(t, (body, c) =>
    body.messages.some((m) => m.role === "tool")
      ? reply()
      : reply("", [
          {
            name: "propose_tags",
            args: { mediaId: c.id, operation: "add", tagIds: [c.otherTag] },
          },
        ]),
  );
  let s = await f.send();
  f.tags.get(f.otherTag).Text = "Renamed";
  s = (await f.chat.decide(s.sessionId, s.proposals[0].id, "accept")).session;
  assert.equal(s.proposals[0].status, "stale");
  assert.equal(f.backups(), 0);
  const disk = await f.store.load(s.sessionId);
  const forged = structuredClone(disk);
  forged.proposals[0].mediaId = randomUUID();
  assert.throws(
    () =>
      require("../src/main/chat/schema").assertSession(
        forged,
        f.library.manifest.libraryId,
      ),
    /origin|authority/,
  );
  const missingSnapshot = structuredClone(disk);
  missingSnapshot.proposals[0].tags = [];
  assert.throws(
    () =>
      require("../src/main/chat/schema").assertSession(
        missingSnapshot,
        f.library.manifest.libraryId,
      ),
    /snapshot/,
  );
});


test("an unrecovered transaction blocks new mutations until recovery", async t => {
  const f = await fixture(t);
  const { assertMutationReady } = require("../src/main/mutation-coordinator");
  assertMutationReady(f.library);
  await fs.writeFile(f.library.paths.transactionFile, "pending journal");
  assert.throws(() => assertMutationReady(f.library), { code: "RECOVERY_REQUIRED" });
  await fs.rm(f.library.paths.transactionFile);
  assertMutationReady(f.library);
});


test("tag pagination distinguishes invalid cursors, different queries and registry changes", async () => {
  const tags = Array.from({length: 55}, (_, i) => ({TagId: randomUUID(), Text: `Tag ${String(i).padStart(2,'0')}`, Description: ''}));
  const ctx = { signal: new AbortController().signal, budget: createBudget(), enabled: ['find_library_tags'], scope: {groups:{basic:true},mediaIds:[randomUUID()]}, represented:new Set(), checkLibrary(){}, tags:()=>tags };
  const lookup = (query, cursor) => metadataTools.execute({name:'find_library_tags',arguments:JSON.stringify({query,cursor})},ctx);
  const first = await lookup('Tag',null);
  assert.equal(first.tags.length,50);
  const last = await lookup('Tag',first.cursor);
  assert.equal(last.tags.length,5); assert.equal(last.cursor,null);
  assert.equal((await lookup('Tag','null')).code,'invalid_cursor');
  assert.equal((await lookup('Other',first.cursor)).code,'cursor_query_mismatch');
  tags[0].Description='Updated';
  assert.equal((await lookup('Tag',first.cursor)).code,'resource_conflict');
  assert.equal((await lookup('Tag',null)).status,'success');
});

test("tag lookup stops after two failures including queued calls and resets next turn", async t => {
  let offered = [];
  const f = await fixture(t, body => {
    const current = body.messages.slice(body.messages.findLastIndex(m=>m.role==='user')+1);
    const outcomes = current.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
    offered = (body.tools || []).map(t=>t.function.name);
    if (!outcomes.length) return reply('',Array.from({length:3},()=>({name:'find_library_tags',args:{query:'',cursor:'bad'}})));
    assert.equal(outcomes[0].code,'invalid_cursor');
    assert.equal(outcomes[1].code,'invalid_cursor');
    assert.match(outcomes[1].message,/disabled for the rest of this turn/);
    assert.equal(outcomes[2].code,'permission_denied');
    assert.ok(!offered.includes('find_library_tags'));
    assert.ok(offered.includes('propose_title'));
    return reply('Tag lookup could not complete.');
  });
  await f.send('Suggest tags');
  await f.send('Try finding tags again');
  const initial = f.requests.filter(body => !body.messages.slice(body.messages.findLastIndex(m=>m.role==='user')+1).some(m=>m.role==='tool'));
  assert.equal(initial.length,2);
  assert.ok(initial.every(body=>body.tools.some(t=>t.function.name==='find_library_tags')));
});

test("one corrected tag lookup succeeds and ordinary discussion retains its own request", async t => {
  const f = await fixture(t, body => {
    const text = body.messages.filter(m=>m.role==='user').at(-1).content[0].text;
    const system = body.messages[0].content;
    assert.match(system,/ordinary conversation, not requests to edit metadata/);
    assert.match(system,/Previous tool activity does not authorize more proposals/);
    if (text==='What is this?') return reply('A red image.');
    const outcomes = body.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
    if (!outcomes.length) return reply('',[{name:'find_library_tags',args:{query:'',cursor:'bad'}}]);
    if (outcomes.length===1) return reply('',[{name:'find_library_tags',args:{query:'',cursor:null}}]);
    assert.equal(outcomes[1].status,'success');
    assert.ok(body.tools.some(t=>t.function.name==='find_library_tags'));
    return reply('Existing tags found.');
  });
  await f.send('Find existing tags');
  const result = await f.send('What is this?');
  assert.equal(result.proposals.length,0);
  assert.equal(f.index.get(f.id).Customization.Title,'Original');
});
