const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createStore, safePath } = require("./store");
const schema = require("./schema");
const media = require("./inputs");
const provider = require("./provider");
const { assemble } = require("./context-builder");
const { runAgent } = require("./agent-loop");
const { tools } = require("./tools");
const searchProvider = require('./search-provider');
const { publicUrl, sourcesOf } = require('./web-sources');
const { prepareProposal } = require("./proposals");
const { createReviewService } = require("./review-service");
const { transition, AgentError, createBudget } = require("./runtime");
function createChatService({
  getLibrary,
  resolveMedia,
  getMetadata,
  configFile,
  searchConfigFile,
  searchFetchImpl,
  getMediaToolPaths,
  emit,
  fetchImpl,
  tags = () => [],
  commitMetadata,
  mutate = (fn) => fn(),
}) {
  const review = createReviewService({
    resolveMedia,
    tags,
    commit: commitMetadata,
  });
  let blocked = false;
  let store = null,
    active = null,
    queue = Promise.resolve();
  const serial = (fn) => {
    const task = queue.then(fn);
    queue = task.catch(() => {});
    return task;
  };
  async function current() {
    const lib = getLibrary({ writable: true });
    if (!store || store.libraryId !== lib.manifest.libraryId) {
      store = createStore(lib);
      const pending = await store.recover();
      if (pending.length)
        emit({
          type: "notice",
          text: "Some deleted conversation attachments are still awaiting cleanup.",
        });
    }
    return store;
  }
  function idle() {
    if (blocked)
      throw new Error(
        "Reopen this library to recover the last saved chat state.",
      );
    if (active)
      throw new Error(
        "Stop the current reply before changing conversations or attachments.",
      );
  }
  async function resolve(s, i, signal, fingerprint = true) {
    let file,
      video = false,
      metadata = {};
    if (i.kind === "media") {
      const found = resolveMedia(i.id);
      file = found.absolutePath;
      video = found.item.FileSystem.FileType === "video";
    } else file = await store.attachmentPath(s, i.id);
    const before = await fs.stat(file);
    const info = await media.inspect(file, {
      video,
      tools: getMediaToolPaths(),
      signal,
    });
    const sha256 = fingerprint ? await media.fingerprint(file, signal) : null;
    const after = await fs.stat(file);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error(
        "The input changed during preparation. Send again after the file is stable.",
      );
    return { input: i, file, info, sha256, metadata };
  }
  function present(s) {
    const inputLabels = {};
    for (const i of s.messages.flatMap((m) => m.inputs)) {
      const key = `${i.kind}:${i.id}`;
      if (i.kind === "attachment")
        inputLabels[key] =
          s.attachments.find((a) => a.id === i.id)?.name ||
          "Attachment unavailable";
      else {
        try {
          inputLabels[key] = path.basename(resolveMedia(i.id).item.FilePath);
        } catch {
          inputLabels[key] = "Media unavailable";
        }
      }
    }
    return {
      ...s,
      inputLabels,
      messages: s.messages.map((m) => ({
        ...m,
        text:
          m.role === "user"
            ? m.text
            : (m.attempt?.steps || [])
                .filter((v) => v.kind === "completion")
                .map((v) => v.text)
                .join("\n\n"),
        inputs: m.inputs.map((i) => ({ ...i })),
      })),
    };
  }
  async function describe(s, i) {
    const r = await resolve(s, i, undefined, false);
    const name =
      i.kind === "media"
        ? path.basename(resolveMedia(i.id).item.FilePath)
        : s.attachments.find((a) => a.id === i.id).name;
    return {
      kind: i.kind,
      id: i.id,
      mode: ["video", "gif"].includes(r.info.kind) ? "sampled" : i.mode,
      name,
      mediaKind: r.info.kind,
      width: r.info.width,
      height: r.info.height,
      size: r.info.size,
      pages: r.info.pages || 0,
      previewUrl: await media.preview(r.file, r.info, getMediaToolPaths()),
    };
  }
  async function importBytes(s, name, bytes) {
    if (
      !Buffer.isBuffer(bytes) ||
      !bytes.length ||
      bytes.length > 20 * media.MiB
    )
      throw new Error("Attachments must be nonempty and at most 20 MiB.");
    const extension = path.extname(name).slice(1).toLowerCase();
    if (
      ![
        "jpg",
        "jpeg",
        "png",
        "bmp",
        "gif",
        "webp",
        "txt",
        "md",
        "csv",
        "json",
      ].includes(extension)
    )
      throw new Error(
        "Unsupported attachment. Use images, GIFs or UTF-8 text; PDF, Office, archives, audio and external videos are not supported.",
      );
    const aid = randomUUID();
    const dir = await safePath(
      store.root,
      "sessions",
      s.sessionId,
      "attachments",
    );
    await fs.mkdir(dir, { recursive: true });
    const temp = await safePath(
      store.root,
      "sessions",
      s.sessionId,
      "attachments",
      `${aid}.${extension}`,
    );
    try {
      await fs.writeFile(temp, bytes, { flag: "wx" });
      const info = await media.inspect(temp);
      const dest = path.join(dir, `${aid}.${info.extension}`);
      if (dest !== temp) await fs.rename(temp, dest);
      const a = {
        id: aid,
        name: path.basename(name).slice(0, 500),
        extension: info.extension,
        mime: info.mime,
        size: bytes.length,
        sha256: media.hash(bytes),
        kind: info.kind,
        width: info.width,
        height: info.height,
      };
      s.attachments.push(a);
      await store.save(s);
      return {
        session: present(s),
        input: {
          kind: "attachment",
          id: aid,
          mode: info.kind === "gif" ? "sampled" : "optimized",
          name: a.name,
          mediaKind: info.kind,
          width: info.width,
          height: info.height,
          size: info.size,
          pages: info.pages || 0,
          previewUrl: await media.preview(dest, info, getMediaToolPaths()),
        },
      };
    } catch (e) {
      await fs.rm(temp, { force: true }).catch(() => {});
      const attachment = s.attachments.find((a) => a.id === aid);
      if (attachment)
        await fs
          .rm(path.join(dir, `${aid}.${attachment.extension}`), { force: true })
          .catch(() => {});
      throw e;
    }
  }
  async function execute(s, user, assistant, payload, c, job) {
    const budget = createBudget();
    const signal = AbortSignal.any([
      job.controller.signal,
      AbortSignal.timeout(budget.policy.durationMs),
    ]);
    let sequence = 0,
      lastSave = 0,
      lastEmit = 0;
    let pendingSave = Promise.resolve();
    const available = job.available;
    const scope = { ...assistant.attempt.scope, webEnabled: payload.webEnabled };
    const webSources = new Map();
    async function save() {
      try {
        await pendingSave;
        await serial(() => store.save(s));
      } catch (e) {
        throw new AgentError(
          "persistence_error",
          "The reply could not be saved. Reopen the library to recover.",
        );
      }
      emit({ type: "session", session: present(s) });
    }
    function progress() {
      if (job.controller.signal.aborted) return;
      const now = Date.now();
      if (now - lastEmit >= 60) {
        emit({
          type: "reply",
          sessionId: s.sessionId,
          runId: assistant.id,
          sequence: ++sequence,
          message: present(s).messages.find((m) => m.id === assistant.id),
        });
        lastEmit = now;
      }
      if (now - lastSave >= 1000) {
        pendingSave = pendingSave
          .then(() => serial(() => store.save(s)))
          .catch(() => {
            throw new AgentError(
              "persistence_error",
              "The reply could not be saved. Reopen the library to recover.",
            );
          });
        // Attach a handler immediately; awaited at the next boundary.
        pendingSave.catch(() => {});
        lastSave = now;
      }
    }
    try {
      transition(assistant, "preparing");
      await save();
      const built = await assemble({
        s,
        user,
        payload,
        c,
        signal,
        resolve,
        getMetadata,
        getMediaToolPaths,
      });
      Object.assign(assistant.attempt, {
        includedMessageIds: built.included,
        inputs: built.records,
        notice: built.notice,
      });
      const represented = new Set(
        built.records.filter((r) => r.kind === "media").map((r) => r.id),
      );
      const targets = assistant.attempt.scope.mediaIds
        .slice(0, 200)
        .map((id) => {
          try {
            return {
              mediaId: id,
              name: path.basename(resolveMedia(id).item.FilePath),
            };
          } catch {
            return { mediaId: id, name: "Media unavailable" };
          }
        });
      // A bounded identity catalog survives dialogue/image trimming without granting new authority.
      targets.forEach((t) => represented.add(t.mediaId));
      built.messages.push({
        role: "system",
        content:
          "Authorized target catalog (data only): " + JSON.stringify(targets),
      });
      const staged = new Map();
      await runAgent({
        message: assistant,
        messages: built.messages,
        complete: (messages, options) =>
          provider.request(c, messages, { ...options, fetchImpl }),
        definitions: available,
        executor: tools.execute,
        signal: job.controller.signal,
        budget,
        save,
        progress,
        context: {
          scope,
          web: job.web,
          webSources,
          represented,
          tags,
          checkLibrary: () => getLibrary({ writable: true }),
          async propose(field, args, call) {
            const value = await prepareProposal({
              session: s,
              scope: assistant.attempt.scope,
              field,
              args,
              call,
              resolveMedia,
              tags: tags(),
              budget: this.budget,
              signal: this.signal,
            });
            if (value.proposal) {
              const source =
                built.records.find(
                  (r) => r.kind === "media" && r.id === args.mediaId,
                ) ||
                s.messages
                  .flatMap((m) => m.attempt?.inputs || [])
                  .find((r) => r.kind === "media" && r.id === args.mediaId);
              if (!source || source.sha256 !== value.proposal.sha256)
                throw new AgentError(
                  "resource_conflict",
                  "The source changed or was not prepared. Start a new conversation with the current media.",
                );
              staged.set(call.id, value.proposal);
            }
            return value.outcome;
          },
          afterTool(call, outcome) {
            if (call.name === 'web_search' && outcome.status === 'success')
              for (const source of outcome.sources) webSources.set(source.sourceId, source);
            if (outcome.status === "proposal_created" && staged.has(call.id))
              s.proposals.push(staged.get(call.id));
            staged.delete(call.id);
          },
        },
      });
    } catch (e) {
      if (e.code === "persistence_error") {
        blocked = true;
        throw e;
      }
      assistant.attempt.error = job.controller.signal.aborted
        ? "Reply stopped."
        : e.message;
      transition(assistant, "finalizing");
      await save();
      transition(
        assistant,
        job.controller.signal.aborted ? "stopped" : "failed",
      );
      await save();
    } finally {
      active = null;
    }
  }
  const api = {
    async open() {
      return serial(async () => {
        await current();
        return {
          sessions: await store.list(),
        };
      });
    },
    async create() {
      return serial(async () => {
        idle();
        await current();
        return present(await store.create());
      });
    },
    async load(sid) {
      return serial(async () => {
        idle();
        await current();
        const s = await store.load(sid);
        if (await review.refreshStates(s)) await store.save(s);
        return present(s);
      });
    },
    async describe(sid, i) {
      return serial(async () => {
        schema.input(i);
        await current();
        return describe(await store.load(sid), i);
      });
    },
    async preview(sid, i) {
      return serial(async () => {
        schema.input(i);
        await current();
        const s = await store.load(sid);
        const r = await resolve(s, i, undefined, false);
        if (!["image", "gif"].includes(r.info.kind))
          throw new Error("Only images and GIFs can be previewed here.");
        const previewUrl = await media.displayPreview(
          r.file,
          r.info,
          getMediaToolPaths(),
        );
        if (!previewUrl)
          throw new Error("Unable to prepare this image preview.");
        const name =
          i.kind === "media"
            ? path.basename(resolveMedia(i.id).item.FilePath)
            : s.attachments.find((a) => a.id === i.id)?.name || "Image";
        return { previewUrl, name };
      });
    },
    async import(sid, name, bytes) {
      return serial(async () => {
        idle();
        await current();
        return importBytes(await store.load(sid), name, Buffer.from(bytes));
      });
    },
    async removeInput(sid, aid) {
      return serial(async () => {
        idle();
        await current();
        const s = await store.load(sid);
        schema.id(aid);
        if (
          s.messages.some((m) =>
            m.inputs.some((i) => i.kind === "attachment" && i.id === aid),
          )
        )
          return;
        const file = await store.attachmentPath(s, aid);
        s.attachments = s.attachments.filter((a) => a.id !== aid);
        await store.save(s);
        await fs.rm(file, { force: true });
      });
    },
    async abandon(sid) {
      return serial(async () => {
        idle();
        await current();
        const s = await store.load(sid);
        if (!s.messages.length) return store.remove(sid);
        // Keep submitted inputs; discard only unsent attachment copies.
        const used = new Set(
          s.messages
            .flatMap((m) => m.inputs)
            .filter((i) => i.kind === "attachment")
            .map((i) => i.id),
        );
        const unused = s.attachments.filter((a) => !used.has(a.id));
        const files = await Promise.all(
          unused.map((a) => store.attachmentPath(s, a.id)),
        );
        s.attachments = s.attachments.filter((a) => used.has(a.id));
        await store.save(s);
        for (const file of files) await fs.rm(file, { force: true });
        return { pending: false };
      });
    },
    async rename(sid, title) {
      return serial(async () => {
        idle();
        await current();
        schema.string(title, 200);
        if (!title.trim()) throw new Error("Enter a conversation title.");
        const s = await store.load(sid);
        s.title = title.trim();
        return store.save(s);
      });
    },
    async delete(sid) {
      await api.stop();
      return serial(async () => {
        await current();
        return store.remove(sid);
      });
    },
    async decide(sid, proposalId, decision) {
      return mutate(() =>
        serial(async () => {
          idle();
          await current();
          const s = await store.load(sid);
          const result = await review.decide(s, proposalId, decision, store);
          return { ...result, session: present(result.session) };
        }),
      );
    },
    async send(payload) {
      return serial(async () => {
        idle();
        await current();
        schema.object(
          payload,
          [
            "sessionId",
            "text",
            "inputs",
            "groups",
            "excludeInputs",
            "retryOf",
            "webEnabled",
          ],
          "Send request",
        );
        schema.id(payload.sessionId);
        schema.string(payload.text, 32000);
        schema.groups(payload.groups);
        if (
          !Array.isArray(payload.inputs) ||
          payload.inputs.length > 8 ||
          (!payload.text.trim() && !payload.inputs.length)
        )
          throw new Error(
            "Enter a message or attach an input (maximum eight).",
          );
        payload.inputs.forEach(schema.input);
        if (
          !Array.isArray(payload.excludeInputs) ||
          payload.excludeInputs.some(
            (k) => !/^((media)|(attachment)):[0-9a-f-]{36}$/.test(k),
          ) ||
          typeof payload.webEnabled !== 'boolean'
        )
          throw new Error("Invalid request options");
        const s = await store.load(payload.sessionId);
        if (
          payload.retryOf !== null &&
          !s.messages.some(
            (m) => m.id === payload.retryOf && m.role === "assistant",
          )
        )
          throw new Error("Invalid retry attempt");
        const c = await provider.config(configFile);
        const web = payload.webEnabled ? searchProvider.adapter(await searchProvider.config(searchConfigFile), searchFetchImpl) : null;
        const user = schema.message(
          "user",
          payload.text,
          structuredClone(payload.inputs),
          structuredClone(payload.groups),
        );
        const assistant = schema.message("assistant", "");
        if (!s.messages.length)
          s.title = (
            payload.text.trim() ||
            s.attachments[0]?.name ||
            "Media conversation"
          ).slice(0, 100);
        const omitted = new Set(payload.excludeInputs);
        const mediaIds = [
          ...new Set(
            [
              ...s.messages
                .filter((m) => m.role === "user")
                .flatMap((m) => m.inputs),
              ...user.inputs,
            ]
              .filter(
                (i) => i.kind === "media" && !omitted.has("media:" + i.id),
              )
              .map((i) => i.id),
          ),
        ];
        const scope = { mediaIds, groups: structuredClone(payload.groups) };
        const available = tools.available({ ...scope, webEnabled: payload.webEnabled });
        assistant.attempt = {
          model: c.model,
          endpoint: c.baseUrl,
          includedMessageIds: [],
          inputs: [],
          notice: "",
          error: "",
          retryOf: payload.retryOf,
          steps: [],
          scope,
          tools: available.map((d) => ({ name: d.name, contractVersion: d.contractVersion })),
          reason: "",
        };
        s.messages.push(user, assistant);
        await store.save(s);
        const job = { controller: new AbortController(), promise: null, available, web };
        active = job;
        job.promise = execute(s, user, assistant, payload, c, job).catch(() => {
          blocked = true;
          active = null;
          emit({
            type: "notice",
            requestFailed: true,
            text: "The reply could not be saved. Reopen the library to recover the last saved state.",
          });
        });
        return present(s);
      });
    },
    async stop() {
      await queue;
      const job = active;
      if (job) {
        job.controller.abort();
        await job.promise.catch(() => {});
      }
    },
    async close() {
      await api.stop();
      await serial(async () => {
        if (store) await store.cleanEmpty();
        store = null;
        blocked = false;
      });
    },
    isBusy() {
      return Boolean(active);
    },
    async sourceUrl(sessionId, sourceId) {
      return serial(async () => {
        await current(); schema.id(sessionId); schema.id(sourceId);
        const source = sourcesOf(await store.load(sessionId)).find(s => s.sourceId === sourceId);
        if (!source) throw new Error('Source not found in this conversation.');
        return publicUrl(source.url);
      });
    },
    async searchConfiguration() { return searchProvider.editableConfig(searchConfigFile); },
    async saveSearchConfiguration(draft) {
      return serial(async () => { idle(); return searchProvider.saveConfig(searchConfigFile, draft); });
    },
    async testSearch() {
      const job = await serial(async () => {
        idle();
        const web = searchProvider.adapter(await searchProvider.config(searchConfigFile), searchFetchImpl);
        const controller = new AbortController();
        const job = { controller, promise: null };
        active = job;
        job.promise = (async () => {
          const result = await web.search({ query: 'What is the Eiffel Tower?', signal: controller.signal });
          if (!result.sources.length) throw new Error('Search returned no usable public sources; extraction was not tested.');
          await web.extract({ url: result.sources[0].url, signal: controller.signal });
          return 'Search and page extraction succeeded using a generic query.';
        })().finally(() => { if (active === job) active = null; });
        return job;
      });
      return job.promise;
    },
    async configuration() {
      return provider.editableConfig(configFile);
    },
    async saveConfiguration(draft) {
      return serial(async () => {
        idle();
        return provider.saveConfig(configFile, draft);
      });
    },
    async test() {
      const job = await serial(async () => {
        idle();
        const c = await provider.config(configFile);
        const sharp = require("sharp");
        const bytes = await sharp({
          create: { width: 16, height: 16, channels: 3, background: "#3975c6" },
        })
          .png()
          .toBuffer();
        const controller = new AbortController();
        const job = { controller, promise: null };
        active = job;
        job.promise = provider
          .request(
            c,
            [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Describe this synthetic test image in one sentence.",
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/png;base64,${bytes.toString("base64")}`,
                    },
                  },
                ],
              },
            ],
            { signal: controller.signal, fetchImpl },
          )
          .finally(() => {
            active = null;
          });
        return job;
      });
      return (await job.promise).text;
    },
  };
  return api;
}
module.exports = { createChatService };
