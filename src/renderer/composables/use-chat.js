import { ref, computed, watch, onBeforeUnmount } from "vue";
export function useChat({ api, copyText, selectedItem, libraryState, view, reviewBlocked = () => false, beforeReview = () => {}, afterReview = async () => {} }) {
  const copiedMessage = ref(null);
  let copyTimer;
  async function copyMessage(message) {
    try {
      await copyText(message.text);
      clearTimeout(copyTimer);
      copiedMessage.value = message.id;
      copyTimer = setTimeout(() => { copiedMessage.value = null; }, 1800);
    } catch {
      error.value = "Unable to copy this message. Please try again.";
    }
  }
  const session = ref(null),
    visible = ref(false),
    busy = ref(false),
    working = ref(false),
    text = ref(""),
    inputs = ref([]),
    quality = ref("optimized");
  const imagePreview = ref(null);
  let previewRequest = 0;
  const error = ref(""),
    notice = ref(""),
    options = ref(false),
    historyOpen = ref(false),
    history = ref([]),
    currentOnly = ref(false),
    settings = ref(false),
    configuration = ref(null);
  const renameTitle = ref("");
  const groups = ref({
    basic: true,
    location: false,
    people: false,
    hidden: false,
    technical: false,
  });
  const filteredHistory = computed(() =>
    history.value.filter(
      (s) =>
        !currentOnly.value || s.mediaIds?.includes(selectedItem.value?.MediaId),
    ),
  );
  const sentPreviews = ref({});
  watch(
    () => JSON.stringify([session.value?.sessionId, (session.value?.messages || []).flatMap(m => m.inputs).map(i => i.kind + ':' + i.id)]),
    async (_, __, onCleanup) => {
      let cancelled = false;
      onCleanup(() => { cancelled = true; });
      const currentSession = session.value;
      sentPreviews.value = {};
      if (!currentSession) return;
      const unique = new Map(currentSession.messages.flatMap(m => m.inputs).map(i => [i.kind + ':' + i.id, i]));
      for (const [key, input] of unique) {
        if (cancelled) return;
        const pending = inputs.value.find(i => i.kind === input.kind && i.id === input.id);
        if (pending) { sentPreviews.value[key] = pending; continue; }
        try {
          const result = await api.describe(currentSession.sessionId, JSON.parse(JSON.stringify(input)));
          if (cancelled) return;
          if (result.ok) sentPreviews.value[key] = result.value;
        } catch { /* Missing sources retain a readable file tile. */ }
      }
    },
  );
  const counts = computed(() => {
    const result = inputs.value.map((i) =>
      i.mediaKind === "text" ? 0 : i.mediaKind === "image" ? 1 : 2,
    );
    let left = 8 - result.reduce((a, b) => a + b, 0),
      progress = true;
    while (left > 0 && progress) {
      progress = false;
      inputs.value.forEach((i, n) => {
        const cap =
          i.mediaKind === "video"
            ? 8
            : i.mediaKind === "gif"
              ? Math.min(4, i.pages)
              : result[n];
        if (left > 0 && result[n] < cap) {
          left--;
          result[n]++;
          progress = true;
        }
      });
    }
    return result;
  });
  const hasOriginal = computed(() =>
    inputs.value.some(
      (i) =>
        i.mediaKind === "image" && (i.override || quality.value) === "original",
    ),
  );
  const inputLimitError = computed(() =>
    counts.value.reduce((a, b) => a + b, 0) > 8
      ? "Remove an input: each video or GIF needs at least two of the eight available image slots."
      : inputs.value.some(
            (i) =>
              i.mediaKind === "image" &&
              (i.override || quality.value) === "original" &&
              i.size > 20 * 1024 * 1024,
          )
        ? "An original image exceeds 20 MiB. Choose optimized quality or remove it."
        : "",
  );
  async function unwrap(p) {
    const r = await p;
    if (!r.ok) throw new Error(r.error);
    return r.value;
  }
  function closeImagePreview() {
    previewRequest++;
    imagePreview.value = null;
  }
  function normalizeImagePreviewGroup(input, name, candidates) {
    const selectedKey = `${input.kind}:${input.id}`;
    const source = Array.isArray(candidates) && candidates.length
      ? candidates
      : [{ input, name }];
    const unique = new Map();
    for (const candidate of source) {
      const candidateInput = candidate?.input || candidate;
      if (!['image', 'gif'].includes(candidateInput?.mediaKind)) continue;
      const key = `${candidateInput.kind}:${candidateInput.id}`;
      if (!unique.has(key)) unique.set(key, {
        key,
        input: candidateInput,
        name: candidate?.name || candidateInput.name || 'Image',
        resolved: false,
        previewUrl: '',
        error: '',
      });
    }
    if (!unique.has(selectedKey)) unique.set(selectedKey, {
      key: selectedKey,
      input,
      name,
      resolved: false,
      previewUrl: '',
      error: '',
    });
    return [...unique.values()];
  }
  async function selectImagePreview(index) {
    const preview = imagePreview.value;
    if (!preview || index < 0 || index >= preview.items.length) return false;
    const item = preview.items[index];
    preview.index = index;
    preview.name = item.name;
    preview.loading = !item.resolved;
    preview.previewUrl = item.previewUrl;
    preview.error = item.error;
    if (item.resolved) return true;
    const request = ++previewRequest;
    const sessionId = session.value?.sessionId;
    if (!sessionId) return false;
    try {
      const value = await unwrap(api.preview(sessionId, {
        kind: item.input.kind,
        id: item.input.id,
        mode: item.input.mode,
      }));
      if (imagePreview.value !== preview || session.value?.sessionId !== sessionId) return false;
      item.resolved = true;
      item.previewUrl = value.previewUrl;
      item.name = value.name || item.name;
      item.error = '';
    } catch (e) {
      if (imagePreview.value !== preview || session.value?.sessionId !== sessionId) return false;
      item.resolved = true;
      item.previewUrl = '';
      item.error = e.message;
    }
    if (request === previewRequest && preview.index === index) {
      preview.loading = false;
      preview.previewUrl = item.previewUrl;
      preview.name = item.name;
      preview.error = item.error;
    }
    return true;
  }
  async function openImagePreview(input, name = input.name || 'Image', candidates = null) {
    if (!session.value || !['image', 'gif'].includes(input.mediaKind)) return false;
    const items = normalizeImagePreviewGroup(input, name, candidates);
    const selectedKey = `${input.kind}:${input.id}`;
    const index = Math.max(0, items.findIndex((item) => item.key === selectedKey));
    imagePreview.value = { items, index, loading: true, previewUrl: '', name, error: '' };
    return selectImagePreview(index);
  }
  async function previousImagePreview() {
    if (!imagePreview.value || imagePreview.value.index === 0) return false;
    return selectImagePreview(imagePreview.value.index - 1);
  }
  async function nextImagePreview() {
    if (!imagePreview.value || imagePreview.value.index >= imagePreview.value.items.length - 1) return false;
    return selectImagePreview(imagePreview.value.index + 1);
  }
  const replySequences = new Map();
  let generation = 0;
  let transition = Promise.resolve();
  const operations = new Set();
  async function action(fn) {
    const operation = runAction(fn);
    operations.add(operation);
    try { return await operation; } finally { operations.delete(operation); }
  }
  async function runAction(fn) {
    const epoch = generation;
    error.value = "";
    working.value = true;
    try {
      return await fn();
    } catch (e) {
      if (epoch === generation) error.value = e.message;
      return null;
    } finally {
      if (epoch === generation) working.value = false;
    }
  }
  const stop = async () => {
    await unwrap(api.stop());
    busy.value = false;
  };
  const unsubscribe = api.onEvent((event) => {
    if (event.type === "provider-configuration-changed") {
      notice.value = event.text;
      return;
    }
    if (event.type === "notice") {
      notice.value = event.text;
      if (event.requestFailed) busy.value = false;
      return;
    }
    if (
      event.type === "session" &&
      event.session.sessionId === session.value?.sessionId
    ) {
      if ((event.session.revision ?? 0) < (session.value?.revision ?? 0)) return;
      session.value = event.session;
      busy.value = event.session.messages.some((m) =>
        ["pending", "preparing", "generating", "executing", "finalizing"].includes(m.status),
      );
    }
    if (
      event.type === "reply" &&
      event.sessionId === session.value?.sessionId
    ) {
      const index = session.value.messages.findIndex(
        (m) => m.id === event.message.id,
      );
      if (index >= 0) {
        if (!['pending','preparing','generating','executing','finalizing'].includes(session.value.messages[index].status)) return;
        const key = event.runId || event.message.id;
        if ((event.sequence || 0) <= (replySequences.get(key) || -1)) return;
        replySequences.set(key,event.sequence || 0);
        session.value.messages[index] = event.message;
      }
    }
  });
  function clearComposer() {
    text.value = "";
    inputs.value = [];
    quality.value = "optimized";
  }
  async function addCurrent() {
    return action(async () => {
      if (!session.value || !selectedItem.value) return;
      if (inputs.value.length >= 8)
        throw new Error("A message can have at most eight attachments.");
      if (
        inputs.value.some(
          (i) => i.kind === "media" && i.id === selectedItem.value.MediaId,
        )
      )
        return;
      const epoch = generation;
      const input = await unwrap(
        api.describe(session.value.sessionId, {
          kind: "media",
          id: selectedItem.value.MediaId,
          mode: quality.value,
        }),
      );
      if (epoch === generation) inputs.value.push({ ...input, override: "" });
    });
  }
  // Drain in-flight imports/submissions before abandoning their session. Only the
  // latest navigation may publish a replacement, including late preview results.
  function replaceSession(sid = null, create = true) {
    closeImagePreview();
    const epoch = ++generation;
    const pending = [...operations];
    working.value = true;
    transition = transition.catch(() => {}).then(async () => {
      await Promise.allSettled(pending);
      if (epoch !== generation) return;
      await stop();
      if (epoch !== generation) return;
      if (session.value) {
        const result = await unwrap(api.abandon(session.value.sessionId));
        if (result?.pending) notice.value = "Attachment cleanup is pending; it will retry when the library opens.";
      }
      session.value = null;
      clearComposer();
      options.value = false;
      historyOpen.value = false;
      if (epoch !== generation || (!sid && !create)) return;
      const next = await unwrap(sid ? api.load(sid) : api.create());
      if (epoch !== generation) {
        if (!sid) await unwrap(api.abandon(next.sessionId));
        return;
      }
      session.value = next;
      renameTitle.value = next.title;
      if (!sid) await addCurrent();
    }).catch(e => {
      if (epoch === generation) error.value = e.message;
    }).finally(() => {
      if (epoch === generation) working.value = false;
    });
    return transition;
  }
  async function newChat() { return replaceSession(); }
  async function open() {
    visible.value = true;
    await transition;
    if (!session.value) await newChat();
  }
  async function close() {
    closeImagePreview();
    visible.value = false;
    await transition;
    await action(stop);
  }
  async function showHistory() {
    return action(async () => {
      await stop();
      const result = await unwrap(api.open());
      history.value = result.sessions;
      historyOpen.value = true;
    });
  }
  async function load(sid) { return replaceSession(sid); }
  async function rename(sid = session.value?.sessionId) {
    return action(async () => {
      const renamed = await unwrap(api.rename(sid, renameTitle.value));
      if (session.value?.sessionId === sid) session.value = renamed;
      await showHistory();
    });
  }
  async function removeSession(sid) {
    return action(async () => {
      const result = await unwrap(api.delete(sid));
      if (result.deleted) {
        if (session.value?.sessionId === sid) {
          session.value = null;
          clearComposer();
        }
        if (result.pending)
          notice.value =
            "Conversation deleted; attachment cleanup is pending because some files are locked.";
        await showHistory();
      }
    });
  }
  async function acceptImport(result) {
    if (result) {
      session.value = result.session;
      inputs.value.push({ ...result.input, override: "" });
    }
  }
  async function attach() {
    return action(async () => {
      if (inputs.value.length >= 8)
        throw new Error("A message can have at most eight attachments.");
      if (!session.value) session.value = await unwrap(api.create());
      await acceptImport(await unwrap(api.choose(session.value.sessionId)));
    });
  }
  async function paste(event) {
    const files = [...(event.clipboardData?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    await action(async () => {
      if (inputs.value.length + files.length > 8)
        throw new Error("A message can have at most eight attachments.");
      if (!session.value) session.value = await unwrap(api.create());
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024)
          throw new Error("Imported files must be at most 20 MiB.");
        let result;
        // Clipboard blobs have no native path; the bridge resolves only genuine File objects.
        try {
          result = await api.importFile(session.value.sessionId, file);
        } catch {
          result = null;
        }
        if (!result)
          result = await api.importBytes(
            session.value.sessionId,
            file.name || "Pasted image.png",
            new Uint8Array(await file.arrayBuffer()),
          );
        await acceptImport(await unwrap(Promise.resolve(result)));
      }
    });
  }
  async function removeInput(index) {
    return action(async () => {
      const i = inputs.value[index];
      if (i.kind === "attachment")
        await unwrap(api.removeInput(session.value.sessionId, i.id));
      inputs.value.splice(index, 1);
    });
  }
  async function decideProposal(proposal, decision) {
    if (busy.value || working.value) return;
    return action(async () => {
      if(decision === 'accept' && reviewBlocked(proposal)) throw new Error('Save or discard your Metadata edits before accepting.');
      beforeReview();
      let item = null;
      try {
        const result = await unwrap(api.decide(session.value.sessionId, proposal.id, decision));
        session.value = result.session;
        item = result.item;
      } finally { await afterReview(item); }
    });
  }
  async function send(retryOf = null, retryUser = null) {
    return action(async () => {
      if (busy.value) return;
      if (!retryUser && inputLimitError.value)
        throw new Error(inputLimitError.value);
      if (!session.value) session.value = await unwrap(api.create());
      busy.value = true;
      try {
        const payload = {
          sessionId: session.value.sessionId,
          text: retryUser?.text ?? text.value,
          inputs:
            retryUser?.inputs ||
            inputs.value.map((i) => ({
              kind: i.kind,
              id: i.id,
              mode: ["video", "gif"].includes(i.mediaKind)
                ? "sampled"
                : i.override || quality.value,
            })),
          groups: retryUser?.groups || groups.value,
          excludeInputs: [],
          acceptChanges: false,
          retryOf,
        };
        session.value = await unwrap(
          api.send(JSON.parse(JSON.stringify(payload))),
        );
        clearComposer();
        options.value = false;
      } catch (e) {
        busy.value = false;
        throw e;
      }
    });
  }
  async function retry(m) {
    const index = session.value.messages.findIndex((v) => v.id === m.id);
    const user = session.value.messages[index - 1];
    if (user?.role === "user") await send(m.id, user);
  }
  async function showSettings() {
    options.value = false;
    notice.value = "";
    settings.value = true;
    await reloadConfiguration();
  }
  async function reloadConfiguration() {
    return action(async () => {
      configuration.value = await unwrap(api.configuration());
    });
  }
  async function saveConfiguration() {
    return action(async () => {
      const { hasKey, ...draft } = configuration.value;
      configuration.value = await unwrap(api.saveConfiguration(JSON.parse(JSON.stringify(draft))));
      notice.value = "Settings saved.";
    });
  }
  async function openConfiguration() {
    return action(() => unwrap(api.openConfiguration()));
  }
  async function testConnection() {
    return action(async () => {
      notice.value = await unwrap(api.test());
    });
  }
  function keydown(event) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      if (!working.value) void send();
    }
  }
  watch(
    () => selectedItem.value?.MediaId,
    () => {
      void replaceSession(null, visible.value && view.value === "viewer");
    },
  );
  watch(view, (value) => {
    if (value !== "viewer") {
      closeImagePreview();
      visible.value = false;
      if (busy.value) void action(stop);
    }
  });
  watch(
    () => libraryState.value?.active?.libraryId,
    () => {
      closeImagePreview();
      replySequences.clear();
      generation++;
      session.value = null;
      visible.value = false;
      busy.value = false;
      clearComposer();
      history.value = [];
    },
  );
  onBeforeUnmount(() => {
    closeImagePreview();
    generation++;
    clearTimeout(copyTimer);
    unsubscribe();
    void api.stop();
  });
  return {
    decideProposal,
    reviewBlocked,
    imagePreview,
    openImagePreview,
    previousImagePreview,
    nextImagePreview,
    closeImagePreview,
    sentPreviews,
    copiedMessage,
    copyMessage,
    session,
    visible,
    busy,
    working,
    text,
    inputs,
    quality,
    error,
    notice,
    options,
    historyOpen,
    filteredHistory,
    currentOnly,
    settings,
    configuration,
    groups,
    renameTitle,
    counts,
    hasOriginal,
    inputLimitError,
    open,
    close,
    newChat,
    addCurrent,
    showHistory,
    load,
    rename,
    removeSession,
    attach,
    paste,
    removeInput,
    send,
    retry,
    stop: () => action(stop),
    showSettings,
    reloadConfiguration,
    saveConfiguration,
    openConfiguration,
    testConnection,
    keydown,
  };
}
