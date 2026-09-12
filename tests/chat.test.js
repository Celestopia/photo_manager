const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const sharp = require("sharp");
const yaml = require("js-yaml");
const { createStore, safePath } = require("../src/main/chat/store");
const { message, defaultGroups } = require("../src/main/chat/schema");
const inputs = require("../src/main/chat/inputs");
const provider = require("../src/main/chat/provider");
const { createChatService } = require("../src/main/chat/service");
const {
  resolveMediaToolPaths,
  runMediaTool,
} = require("../scripts/media-tools");
const tools = resolveMediaToolPaths(path.resolve(__dirname, ".."), {});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "photo-manager-chat-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const library = {
    paths: { root, managerDir: path.join(root, ".photo_manager") },
    manifest: { libraryId: randomUUID() },
  };
  const store = createStore(library);
  return { root, library, store };
}
test("chat stores independent sessions, recovers interruptions and deletes only owned files", async (t) => {
  const { root, store } = await fixture(t);
  const a = await store.create(),
    b = await store.create();
  const original = path.join(root, "original.txt");
  await fs.writeFile(original, "preserve");
  a.messages.push(message("assistant", "partial"));
  b.messages.push(message("user", "Hello"));
  await store.save(b);
  a.messages.push(message("user", "Question"));
  a.messages[0].status = "streaming";
  await store.save(a);
  await store.recover();
  assert.equal(
    (await store.load(a.sessionId)).messages[0].status,
    "interrupted",
  );
  assert.equal((await store.list()).length, 2);
  await store.remove(a.sessionId);
  assert.equal((await store.list()).length, 1);
  assert.equal((await store.load(b.sessionId)).sessionId, b.sessionId);
  assert.equal(await fs.readFile(original, "utf8"), "preserve");
  await assert.rejects(() => store.load("../outside"), /Invalid chat ID/);
  await fs.writeFile(
    path.join(store.root, "sessions", b.sessionId, "session.json"),
    "{bad",
  );
  assert.match((await store.list())[0].error, /corrupt/);
});
test("chat rejects unknown fields and symlink boundaries", async (t) => {
  const { root, store } = await fixture(t);
  const s = await store.create();
  s.extra = true;
  await assert.rejects(() => store.save(s), /unsupported field/);
  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  const link = path.join(root, "linked");
  await fs.symlink(outside, link, "junction");
  await assert.rejects(() => safePath(root, "linked", "file"), /Symbolic/);
});
test("optimized images normalize orientation and size; original preserves exact bytes", async (t) => {
  const { root } = await fixture(t),
    file = path.join(root, "photo.jpg");
  const original = await sharp({
    create: { width: 1500, height: 800, channels: 3, background: "#3975c6" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  await fs.writeFile(file, original);
  const info = await inputs.inspect(file);
  const [raw] = await inputs.prepare(file, info, "original", 1);
  assert.deepEqual(raw.bytes, original);
  const [optimized] = await inputs.prepare(file, info, "optimized", 1);
  assert.equal(optimized.height, 1024);
  assert.ok(optimized.width < 1024);
  assert.ok(optimized.bytes.length <= inputs.MiB);
  assert.equal(
    (await sharp(optimized.bytes).metadata()).orientation,
    undefined,
  );
  assert.deepEqual(await fs.readFile(file), original);
  await assert.rejects(
    () =>
      inputs.prepare(file, { ...info, size: 21 * inputs.MiB }, "original", 1),
    /20 MiB/,
  );
});
test("text, malformed formats, allocation and GIF timing obey limits", async (t) => {
  const { root } = await fixture(t);
  const file = path.join(root, "说明.txt");
  await fs.writeFile(file, "你好");
  assert.equal((await inputs.inspect(file)).text, "你好");
  await fs.writeFile(file, Buffer.from([0xff]));
  await assert.rejects(() => inputs.inspect(file), /UTF-8/);
  assert.deepEqual(
    inputs.allocation([{ kind: "image" }, { kind: "video" }]),
    [1, 7],
  );
  assert.throws(
    () =>
      inputs.allocation(Array.from({ length: 5 }, () => ({ kind: "video" }))),
    /Too many/,
  );
  const samples = inputs.gifSamples([100, 1000, 100, 100], 4);
  assert.equal(samples[3].time, 1.2);
  assert.equal(samples[3].index, 3);
  await fs.writeFile(path.join(root, "bad.png"), "not an image");
  await assert.rejects(
    () => inputs.inspect(path.join(root, "bad.png")),
    /decode/,
  );
});
test("GIF preparation returns composited frames across one timed cycle", async (t) => {
  const { root } = await fixture(t);
  const file = path.join(root, "animation.gif");
  const raw = Buffer.concat([
    Buffer.alloc(16 * 16 * 3, 0),
    Buffer.alloc(16 * 16 * 3, 120),
    Buffer.alloc(16 * 16 * 3, 255),
  ]);
  await sharp(raw, {
    raw: { width: 16, height: 48, channels: 3, pageHeight: 16 },
  })
    .gif({ delay: [100, 900, 200], loop: 0 })
    .toFile(file);
  const info = await inputs.inspect(file);
  assert.equal(info.kind, "gif");
  assert.deepEqual(info.delays, [100, 900, 200]);
  const display = await inputs.displayPreview(file, info, tools);
  const displayStats = await sharp(Buffer.from(display.split(",")[1], "base64")).stats();
  assert.ok(displayStats.channels.every((channel) => channel.mean < 5));
  const frames = await inputs.prepare(file, info, "original", 3);
  assert.equal(frames.length, 3);
  assert.deepEqual(
    frames.map((f) => f.timestamp),
    [0, 0.1, 1],
  );
  assert.notDeepEqual(frames[0].bytes, frames[2].bytes);
});
test(
  "bundled FFmpeg samples library video with actual timestamps and no video upload",
  { timeout: 90000 },
  async (t) => {
    const { root } = await fixture(t);
    const file = path.join(root, "video.mp4");
    await runMediaTool(tools.ffmpegPath, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=64x48:r=10",
      "-t",
      "1.5",
      "-c:v",
      "libx264",
      "-y",
      file,
    ]);
    const info = await inputs.inspect(file, { video: true, tools });
    const frames = await inputs.prepare(file, info, "original", 4, { tools });
    assert.equal(frames.length, 4);
    assert.ok(frames[3].timestamp > 1);
    assert.ok(frames.every((f) => f.mime === "image/jpeg"));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() =>
      inputs.prepare(file, info, "optimized", 4, {
        tools,
        signal: controller.signal,
      }),
    );
  },
);
test("provider streams split SSE, rejects incomplete streams and redacts HTTP bodies", async () => {
  const c = {
    model: "test",
    baseUrl: "https://example.com/v1",
    apiKey: "secret",
    streaming: true,
  };
  const body =
    'data: {"choices":[{"delta":{"content":"你好 **world**"}}]}\r\n\r\ndata: [DONE]\r\n\r\n';
  const result = await provider.request(c, [], {
    fetchImpl: async () => new Response(body),
  });
  assert.equal(result, "你好 **world**");
  await assert.rejects(
    () =>
      provider.request(c, [], {
        fetchImpl: async () =>
          new Response(
            'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
          ),
      }),
    /ended/,
  );
  await assert.rejects(
    () =>
      provider.request(c, [], {
        fetchImpl: async () => new Response("secret raw body", { status: 401 }),
      }),
    (e) => /401/.test(e.message) && !e.message.includes("secret"),
  );
});
test("provider configuration requires deliberate setup and supports local endpoints", async (t) => {
  const { root } = await fixture(t),
    file = path.join(root, "chat-provider.yml");
  await assert.rejects(() => provider.config(file), /base URL/);
  await fs.writeFile(
    file,
    yaml.dump({
      ...provider.DEFAULT,
      baseUrl: "http://127.0.0.1:8000/v1",
      apiKey: "explicit",
    }),
  );
  assert.equal(
    (await provider.config(file, { DASHSCOPE_API_KEY: "environment" })).apiKey,
    "explicit",
  );
  await fs.writeFile(
    file,
    yaml.dump({ ...provider.DEFAULT, baseUrl: "http://public.example/v1" }),
  );
  await assert.rejects(() => provider.config(file), /HTTPS/);
});
test("service sends only selected inputs, persists provenance and leaves sources untouched", async (t) => {
  const { root, library } = await fixture(t);
  const file = path.join(root, "sample.png");
  await sharp({
    create: { width: 12, height: 8, channels: 3, background: "red" },
  })
    .png()
    .toFile(file);
  const mid = randomUUID(),
    configFile = path.join(root, "provider.yml");
  await fs.writeFile(
    configFile,
    yaml.dump({
      ...provider.DEFAULT,
      baseUrl: "https://example.com/v1",
      apiKey: "private-key",
      streaming: false,
    }),
  );
  let captured, completed;
  const finished = new Promise((r) => (completed = r));
  const chat = createChatService({
    getLibrary: () => library,
    resolveMedia: (id) => {
      assert.equal(id, mid);
      return {
        absolutePath: file,
        item: { FileSystem: { FileType: "image" } },
      };
    },
    getMetadata: () => ({ title: "Sample" }),
    configFile,
    getTools: () => tools,
    emit: (e) => {
      if (
        e.type === "session" &&
        e.session.messages.at(-1)?.status === "complete"
      )
        completed(e.session);
    },
    fetchImpl: async (url, options) => {
      captured = JSON.parse(options.body);
      return new Response(
        'data: {"choices":[{"delta":{"content":"A red picture."}}]}\n\ndata: [DONE]\n\n' ,
      );
    },
  });
  const session = await chat.create();
  assert.equal(captured, undefined);
  await chat.send({
    sessionId: session.sessionId,
    text: "Describe it",
    inputs: [{ kind: "media", id: mid, mode: "original" }],
    groups: defaultGroups(),
    excludeInputs: [],
    acceptChanges: false,
    retryOf: null,
  });
  const saved = await finished;
  await chat.stop();
  const uploaded = captured.messages
    .at(-1)
    .content.find((c) => c.type === "image_url").image_url.url;
  assert.deepEqual(
    Buffer.from(uploaded.split(",")[1], "base64"),
    await fs.readFile(file),
  );
  assert.equal(saved.messages.at(-1).attempt.inputs[0].mode, "original");
  const serialized = await fs.readFile(
    path.join(
      library.paths.managerDir,
      "chat",
      "sessions",
      session.sessionId,
      "session.json",
    ),
    "utf8",
  );
  assert.ok(!serialized.includes("private-key"));
  assert.ok(!serialized.includes("base64"));
  await chat.delete(session.sessionId);
  assert.ok((await fs.stat(file)).isFile());
});
async function serviceFixture(t, fetchImpl) {
  const fixtureData = await fixture(t),
    { root, library } = fixtureData;
  const configFile = path.join(root, "provider.yml");
  await fs.writeFile(
    configFile,
    yaml.dump({
      ...provider.DEFAULT,
      baseUrl: "https://example.com/v1",
      streaming: false,
    }),
  );
  const mid = randomUUID(),
    file = path.join(root, "image.png");
  await sharp({
    create: { width: 8, height: 8, channels: 3, background: "red" },
  })
    .png()
    .toFile(file);
  const chat = createChatService({
    getLibrary: () => library,
    resolveMedia: (id) => {
      if (id !== mid) throw new Error("Missing media");
      return {
        absolutePath: file,
        item: { FilePath: "image.png", FileSystem: { FileType: "image" } },
      };
    },
    getMetadata: () => ({ title: "Test" }),
    configFile,
    getTools: () => tools,
    emit: () => {},
    fetchImpl:
      fetchImpl ||
      (async () =>
        new Response(
          'data: {"choices":[{"delta":{"content":"Reply"}}]}\n\ndata: [DONE]\n\n' ,
        )),
  });
  const session = await chat.create();
  const send = async (overrides = {}) => {
    await chat.send({
      sessionId: session.sessionId,
      text: "Question",
      inputs: [],
      groups: defaultGroups(),
      excludeInputs: [],
      acceptChanges: false,
      retryOf: null,
      ...overrides,
    });
    for (let n = 0; chat.isBusy() && n < 300; n++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(chat.isBusy(), false);
    return chat.load(session.sessionId);
  };
  t.after(() => chat.close());
  return { ...fixtureData, chat, session, send, mid, file, configFile };
}
test("history sends at most twelve pairs and explicitly records omitted older turns", async (t) => {
  let sent;
  const { store, session, send } = await serviceFixture(
    t,
    async (url, options) => {
      sent = JSON.parse(options.body);
      return new Response(
        'data: {"choices":[{"delta":{"content":"Reply"}}]}\n\ndata: [DONE]\n\n' ,
      );
    },
  );
  for (let n = 0; n < 14; n++) {
    const u = message("user", "Question " + n),
      a = message("assistant", "Answer " + n);
    a.status = "complete";
    session.messages.push(u, a);
  }
  // UI-only labels are not a persisted field.
  delete session.inputLabels;
  await store.save(session);
  const saved = await send();
  assert.equal(sent.messages.length, 26);
  assert.equal(sent.messages[1].content[0].text, "Question 2");
  assert.match(saved.messages.at(-1).attempt.notice, /Earlier turns/);
  assert.equal(saved.messages.length, 30);
});
test("changed and missing sources require explicit choices; history remains immutable", async (t) => {
  let calls = 0;
  const f = await serviceFixture(t, async () => {
    calls++;
    return new Response(
      'data: {"choices":[{"delta":{"content":"Reply"}}]}\n\ndata: [DONE]\n\n' ,
    );
  });
  const first = await f.send({
    inputs: [{ kind: "media", id: f.mid, mode: "original" }],
  });
  const originalHash = first.messages[1].attempt.inputs[0].sha256;
  await sharp({
    create: { width: 8, height: 8, channels: 3, background: "blue" },
  })
    .png()
    .toFile(f.file);
  let next = await f.send();
  assert.equal(calls, 1);
  assert.match(next.messages.at(-1).attempt.error, /changed/);
  next = await f.send({ acceptChanges: true });
  assert.equal(calls, 2);
  assert.equal(next.messages[1].attempt.inputs[0].sha256, originalHash);
  await fs.unlink(f.file);
  next = await f.send();
  assert.equal(calls, 2);
  assert.match(next.messages.at(-1).attempt.error, /unavailable/);
  next = await f.send({ excludeInputs: ["media:" + f.mid] });
  assert.equal(calls, 3);
  assert.match(next.messages.at(-1).attempt.notice, /excluded/);
});
test("imported attachments survive reopening and are owned by their session only", async (t) => {
  const { chat, session, store } = await serviceFixture(t);
  const bytes = await sharp({
    create: { width: 5, height: 5, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const a = await chat.import(session.sessionId, "剪贴板.png", bytes);
  const second = await chat.create();
  const b = await chat.import(second.sessionId, "剪贴板.png", bytes);
  const fileA = await store.attachmentPath(a.session, a.input.id),
    fileB = await store.attachmentPath(b.session, b.input.id);
  assert.notEqual(fileA, fileB);
  assert.deepEqual(await fs.readFile(fileA), bytes);
  await chat.delete(session.sessionId);
  await assert.rejects(() => fs.stat(fileA), { code: "ENOENT" });
  assert.deepEqual(await fs.readFile(fileB), bytes);
  await chat.removeInput(second.sessionId, b.input.id);
  await assert.rejects(() => fs.stat(fileB), { code: "ENOENT" });
});
test("stopping a stream saves its partial reply and an explicit retry creates another attempt", async (t) => {
  let started;
  const receiving = new Promise((r) => (started = r));
  let count = 0;
  const f = await serviceFixture(t, async (url, options) => {
    count++;
    if (count > 1)
      return new Response(
        'data: {"choices":[{"delta":{"content":"Finished"}}]}\n\ndata: [DONE]\n\n',
      );
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n',
            ),
          );
          options.signal.addEventListener(
            "abort",
            () => controller.error(new Error("Aborted")),
            { once: true },
          );
          started();
        },
      }),
    );
  });
  await fs.writeFile(
    f.configFile,
    yaml.dump({
      ...provider.DEFAULT,
      baseUrl: "https://example.com/v1",
      streaming: true,
    }),
  );
  await f.chat.send({
    sessionId: f.session.sessionId,
    text: "Question",
    inputs: [],
    groups: defaultGroups(),
    excludeInputs: [],
    acceptChanges: false,
    retryOf: null,
  });
  await receiving;
  await new Promise((r) => setTimeout(r, 20));
  await f.chat.stop();
  const stopped = await f.chat.load(f.session.sessionId);
  assert.equal(stopped.messages[1].status, "stopped");
  assert.equal(stopped.messages[1].text, "Partial");
  const next = await f.send({ retryOf: stopped.messages[1].id });
  assert.equal(next.messages.length, 4);
  assert.equal(next.messages[1].text, "Partial");
  assert.equal(next.messages[3].attempt.retryOf, stopped.messages[1].id);
});
test(
  "30-minute video preparation and BMP optimized/original paths use bundled CPU tools",
  { timeout: 90000 },
  async (t) => {
    const { root } = await fixture(t);
    const file = path.join(root, "long.mp4");
    await runMediaTool(tools.ffmpegPath, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=red:s=16x16:r=1",
      "-t",
      "1800",
      "-c:v",
      "libx264",
      "-y",
      file,
    ]);
    const info = await inputs.inspect(file, { video: true, tools });
    assert.equal(info.duration, 1800);
    const frames = await inputs.prepare(file, info, "sampled", 2, { tools });
    assert.ok(frames.at(-1).timestamp >= 1799);
    const bmp = path.join(root, "image.bmp");
    await runMediaTool(tools.ffmpegPath, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=red:s=16x16",
      "-frames:v",
      "1",
      "-y",
      bmp,
    ]);
    const bmpInfo = await inputs.inspect(bmp);
    assert.equal(bmpInfo.mime, "image/bmp");
    assert.deepEqual(
      (await inputs.prepare(bmp, bmpInfo, "original", 1, { tools }))[0].bytes,
      await fs.readFile(bmp),
    );
    assert.equal(
      (await inputs.prepare(bmp, bmpInfo, "optimized", 1, { tools }))[0].mime,
      "image/jpeg",
    );
  },
);

test("optimized transparency becomes white and oversized text is rejected without truncation", async (t) => {
  const { root } = await fixture(t);
  const file = path.join(root, "transparent.png");
  await sharp({
    create: {
      width: 10,
      height: 10,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toFile(file);
  const info = await inputs.inspect(file);
  const [image] = await inputs.prepare(file, info, "optimized", 1);
  const { data } = await sharp(image.bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.ok(data.every((v) => v >= 254));
  const text = path.join(root, "large.txt");
  await fs.writeFile(text, "a".repeat(32001));
  await assert.rejects(() => inputs.inspect(text), /32,000/);
});

test('animated PNG is rejected explicitly instead of silently using its first frame', async t => {
  const {root}=await fixture(t);
  const bytes=await sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer();
  const animationChunk=Buffer.alloc(20);animationChunk.writeUInt32BE(8,0);animationChunk.write('acTL',4);animationChunk.writeUInt32BE(2,8);
  const file=path.join(root,'animated.png');await fs.writeFile(file,Buffer.concat([bytes.subarray(0,33),animationChunk,bytes.subarray(33)]));
  await assert.rejects(()=>inputs.inspect(file),/Only GIF animation/);
});

test('provider form preserves secrets, validates before writing and supports explicit removal', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-config-form-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'provider.yml');
  await fs.writeFile(file, yaml.dump({ ...provider.DEFAULT, baseUrl: 'https://example.com/v1', apiKey: 'private-key' }));
  const { hasKey, ...draft } = await provider.editableConfig(file);
  assert.equal(hasKey, true);
  assert.equal(draft.apiKey, '');
  await provider.saveConfig(file, { ...draft, model: 'another-model' });
  assert.equal((await provider.config(file, {})).apiKey, 'private-key');
  const before = await fs.readFile(file, 'utf8');
  await assert.rejects(provider.saveConfig(file, { ...draft, baseUrl: 'http://example.com' }), /HTTPS/);
  assert.equal(await fs.readFile(file, 'utf8'), before);
  await provider.saveConfig(file, { ...draft, apiKey: 'replacement', thinking: 'omit' });
  assert.equal((await provider.config(file, {})).apiKey, 'replacement');
  assert.equal('enable_thinking' in await provider.config(file, {}), false);
  await provider.saveConfig(file, { ...draft, clearKey: true });
  assert.equal((await provider.editableConfig(file)).hasKey, false);
});

test('attachment thumbnails are cropped while display previews preserve the complete image', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-preview-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'photo.png');
  await sharp({ create: { width: 1600, height: 900, channels: 3, background: 'red' } }).png().toFile(file);
  const preview = await inputs.preview(file, { kind: 'image' }, tools);
  assert.match(preview, /^data:image\/jpeg;base64,/);
  const metadata = await sharp(Buffer.from(preview.split(',')[1], 'base64')).metadata();
  assert.deepEqual([metadata.width, metadata.height], [160, 160]);
  const display = await inputs.displayPreview(file, { kind: 'image' }, tools);
  const displayMetadata = await sharp(Buffer.from(display.split(',')[1], 'base64')).metadata();
  assert.deepEqual([displayMetadata.width, displayMetadata.height], [1280, 720]);
  assert.equal(await inputs.preview(file, { kind: 'text' }, tools), null);
  assert.equal(await inputs.preview(path.join(root, 'missing.png'), { kind: 'image' }, tools), null);
});

test('chat display previews resolve only validated image inputs', async (t) => {
  const f = await serviceFixture(t);
  const result = await f.chat.preview(f.session.sessionId, {
    kind: 'media', id: f.mid, mode: 'optimized',
  });
  assert.equal(result.name, 'image.png');
  assert.match(result.previewUrl, /^data:image\/jpeg;base64,/);
  await assert.rejects(
    f.chat.preview(f.session.sessionId, { kind: 'media', id: randomUUID(), mode: 'optimized' }),
    /Missing media/,
  );
});

test("abandon and recovery remove draft attachments but preserve submitted conversations", async t => {
  const f = await serviceFixture(t);
  const imported = await f.chat.import(f.session.sessionId, "draft.txt", Buffer.from("draft"));
  const file = await f.store.attachmentPath(imported.session, imported.input.id);
  assert.equal((await f.chat.open()).sessions.length, 0);
  await f.chat.abandon(f.session.sessionId);
  await assert.rejects(() => fs.stat(file), { code: "ENOENT" });
  const next = await f.chat.create();
  await f.chat.import(next.sessionId, "leftover.txt", Buffer.from("leftover"));
  await f.store.recover();
  await assert.rejects(() => f.store.load(next.sessionId), { code: "ENOENT" });

  const saved = await f.store.load((await f.chat.create()).sessionId);
  saved.messages.push(message("user", "Saved question"));
  await f.store.save(saved);
  const unused = await f.chat.import(saved.sessionId, "unused.txt", Buffer.from("unused"));
  const unusedFile = await f.store.attachmentPath(unused.session, unused.input.id);
  await f.chat.abandon(saved.sessionId);
  assert.equal((await f.store.load(saved.sessionId)).messages[0].text, "Saved question");
  await assert.rejects(() => fs.stat(unusedFile), { code: "ENOENT" });
  assert.equal((await f.chat.open()).sessions.length, 1);
});

test("a rejected first submission stays a draft, while provider failure preserves history", async t => {
  const f = await serviceFixture(t, async () => new Response('', { status: 500 }));
  await assert.rejects(() => f.chat.send({}), /Send request/);
  assert.equal((await f.chat.open()).sessions.length, 0);
  const s = await f.send();
  assert.equal(s.messages[0].role, "user");
  assert.equal((await f.chat.open()).sessions.length, 1);
  await f.chat.abandon(s.sessionId);
  assert.equal((await f.chat.open()).sessions.length, 1);
});

test('provider always streams and normalizes the former disabled preference', async t => {
  const { root } = await fixture(t);
  const file = path.join(root, 'provider.yml');
  await fs.writeFile(file, yaml.dump({ ...provider.DEFAULT, baseUrl: 'https://example.com/v1', streaming: false }));
  const c = await provider.config(file);
  assert.equal(c.streaming, true);
  const { hasKey, ...draft } = await provider.editableConfig(file);
  assert.equal('streaming' in draft, false);
  await provider.saveConfig(file, draft);
  assert.equal(yaml.load(await fs.readFile(file, 'utf8')).streaming, true);
  await provider.request({ ...c, streaming: false }, [], { fetchImpl: async (_, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n');
  } });
  await assert.rejects(provider.request(c, [], { fetchImpl: async () =>
    new Response('{}', { headers: { 'content-type': 'application/json' } }) }), /does not support streaming/);
});

const { normalizeUsage } = require('../src/main/chat/usage');
test('usage distinguishes missing cache information from zero', () => {
  assert.deepEqual(normalizeUsage({prompt_tokens:10, completion_tokens:3}), {inputTotal:10, output:3, inputCacheHit:null, inputCacheMiss:null});
  assert.equal(normalizeUsage({prompt_tokens:10, prompt_tokens_details:{cached_tokens:0}}).inputCacheMiss, 10);
  assert.equal(normalizeUsage({prompt_tokens:10, prompt_cache_hit_tokens:7}).inputCacheMiss, 3);
});
test('streamed usage-only events persist per completion', async t => {
  const f = await serviceFixture(t, async (_, options) => {
    assert.equal(JSON.parse(options.body).stream_options.include_usage, true);
    return new Response('data: {"choices":[{"delta":{"content":"Reply"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":60}}}\n\ndata: [DONE]\n\n');
  });
  const s = await f.send();
  assert.deepEqual(s.messages.at(-1).attempt.usage, {inputTotal:100,output:20,inputCacheHit:60,inputCacheMiss:40});
  const loaded = await f.store.load(s.sessionId);
  assert.deepEqual(loaded.messages.at(-1).attempt.usage, s.messages.at(-1).attempt.usage);
});
