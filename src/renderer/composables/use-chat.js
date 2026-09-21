import { allocateVisualInputs } from "../../shared/visual-input-allocation.js";
import { ref, computed, watch, onBeforeUnmount } from "vue";
export function useChat({ api, copyText, selectedItem, libraryState, view, reviewBlocked = () => false, beforeReview = () => {}, afterReview = async () => {} }) {
  const copiedMessage = ref(null);
  const webEnabled = ref(false);
  const settingsTab = ref('assistant');
  const searchConfiguration = ref(null);
  const configurationStale = ref(false);
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
  const selectingHistory = ref(false);
  const selectedHistoryIds = ref([]);
  const selectableHistory = computed(() => filteredHistory.value.filter(row => !row.error));
  const selectedHistory = computed(() => selectableHistory.value.filter(row => selectedHistoryIds.value.includes(row.sessionId)));
  const allHistorySelected = computed(() => selectableHistory.value.length > 0 && selectedHistory.value.length === selectableHistory.value.length);
  function clearHistorySelection() { selectedHistoryIds.value = []; }
  function finishHistorySelection() { selectingHistory.value = false; clearHistorySelection(); }
  function toggleHistorySelection(id) {
    if (working.value) return;
    selectedHistoryIds.value = selectedHistoryIds.value.includes(id)
      ? selectedHistoryIds.value.filter(value => value !== id) : [...selectedHistoryIds.value, id];
  }
  function selectAllHistory() {
    if (!working.value) selectedHistoryIds.value = allHistorySelected.value ? [] : selectableHistory.value.map(row => row.sessionId);
  }
  watch(currentOnly, clearHistorySelection, { flush: 'sync' });
  watch([historyOpen, visible, () => selectedItem.value?.MediaId, () => libraryState.value?.active?.libraryId], finishHistorySelection, { flush: 'sync' });
  async function removeSessions(ids) {
    if (working.value) return;
    const epoch = generation;
    const libraryId = libraryState.value?.active?.libraryId;
    return action(async () => {
      const failed = [];
      let pending = false;
      for (const id of [...new Set(ids)]) {
        if (epoch !== generation) return;
        try {
          const result = await unwrap(api.delete(id));
          if (!result.deleted) throw new Error('Conversation was not deleted.');
          // Navigation drains this operation before abandoning the old session.
          // Clear a deleted session even when that navigation has already begun.
          if (libraryId === libraryState.value?.active?.libraryId && session.value?.sessionId === id) {
            webEnabled.value = false;
            session.value = null;
            clearComposer();
          }
          if (epoch !== generation) return;
          pending ||= result.pending;
          history.value = history.value.filter(row => row.sessionId !== id);
          selectedHistoryIds.value = selectedHistoryIds.value.filter(value => value !== id);
        } catch (e) { failed.push({ id, message: e.message }); }
      }
      if (epoch !== generation) return;
      if (!filteredHistory.value.length) finishHistorySelection();
      if (pending) notice.value = 'Conversations deleted; cleanup of locked attachments will retry when the library opens.';
      if (failed.length) error.value = `${failed.length} conversation(s) could not be deleted. Successful deletions are complete. ${failed[0].message}`;
      return { failed: failed.map(item => item.id) };
    });
  }
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
  const counts = computed(() => allocateVisualInputs(inputs.value.map(input => ({
    kind: input.mediaKind, pages: input.pages,
  }))));
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
      configurationStale.value = true;
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
    if (!sid || sid !== session.value?.sessionId) webEnabled.value = false;
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
  function close() {
    // Panel visibility does not own the lifetime of the active run.
    closeImagePreview();
    visible.value = false;
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
          webEnabled.value = false;
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
          retryOf,
          webEnabled: webEnabled.value,
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
  async function showSettings(tab = 'assistant') {
    configuration.value = null;
    searchConfiguration.value = null;
    settingsTab.value = typeof tab === 'string' ? tab : 'assistant';
    options.value = false;
    notice.value = "";
    settings.value = true;
    await reloadConfiguration();
  }
  async function reloadConfiguration() {
    return action(async () => {
      if (configurationStale.value) {
        configuration.value = null;
        searchConfiguration.value = null;
      }
      if (settingsTab.value === 'web') searchConfiguration.value = await unwrap(api.searchConfiguration());
      else configuration.value = await unwrap(api.configuration());
      configurationStale.value = false;
    });
  }
  async function saveConfiguration() {
    return action(async () => {
      if (configurationStale.value) throw new Error('Provider settings changed in another window. Reload settings before saving.');
      if (settingsTab.value === 'web') {
        const { provider, apiKey, apiKeyEnv, clearKey } = searchConfiguration.value;
        searchConfiguration.value = await unwrap(api.saveSearchConfiguration({ provider, apiKey, apiKeyEnv, clearKey }));
      } else {
        const { hasKey, ...draft } = configuration.value;
        configuration.value = await unwrap(api.saveConfiguration(JSON.parse(JSON.stringify(draft))));
      }
      notice.value = "Settings saved.";
    });
  }
  async function openConfiguration() {
    return action(() => unwrap(api.openConfiguration()));
  }
  async function testConnection() {
    return action(async () => {
      if (configurationStale.value) throw new Error('Reload settings before testing.');
      notice.value = await unwrap(settingsTab.value === 'web' ? api.testSearch() : api.test());
    });
  }
  async function toggleWeb() {
    if (busy.value || working.value) return;
    if (webEnabled.value) { webEnabled.value = false; return; }
    const epoch = generation;
    return action(async () => {
      const c = await unwrap(api.searchConfiguration());
      if (epoch !== generation) return;
      searchConfiguration.value = c;
      if (c.configured) webEnabled.value = true;
      else { settingsTab.value = 'web'; settings.value = true; }
    });
  }
  async function openSource(sourceId) {
    if (!session.value) return;
    try { await unwrap(api.openSource(session.value.sessionId, sourceId)); }
    catch (e) { error.value = e.message; }
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
      webEnabled.value = false;
      closeImagePreview();
      visible.value = false;
      if (busy.value) void action(stop);
    }
  });
  watch(
    () => libraryState.value?.active?.libraryId,
    () => {
      webEnabled.value = false;
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
    selectingHistory, selectedHistory, allHistorySelected, selectableHistory, clearHistorySelection, finishHistorySelection, toggleHistorySelection, selectAllHistory, removeSessions,
    webEnabled, toggleWeb, openSource, settingsTab, searchConfiguration, configurationStale,
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
