import { reactive, watch } from "vue";

export function useAgent({ api, getMediaIds, getQuery, getView, openMedia, refresh, acceptDraft, getDraft, getMediaItem = () => null }) {
  const state = reactive({ open: false, mode: "search", query: "", local: false, scope: "gallery", running: false, availableOnly: false,
    groups: ["basic"], tagCatalogue: true, replaceTags: false, preview: null, submitting: false, options: false, searchQuestion: '',
    status: null, error: "", progress: null, messages: [], proposals: [], results: null, history: [], settings: false, applying: false, depth: 200, remaining: [], resultSelection: [], selectionFromResults: false });
  const selectedIds = () => getView() === 'viewer' ? getMediaIds() : state.selectionFromResults ? state.resultSelection : getMediaIds();
  let unsubscribe = null, sequence = 0, requestEpoch = 0, preparation = 0;
  const delivered = new Set();
  const stopWatch = watch(() => getView() + ':' + getMediaIds().join(','), () => {
    state.preview = null;
    requestEpoch++;
    if (getView() === 'viewer') { state.mode = 'chat'; state.selectionFromResults = false; }
    if (state.running) api.agentCancel();
  });
  function receive(entry, key) {
    if (delivered.has(key)) return; delivered.add(key);
    state.messages.push({ mediaId: entry.mediaId, runId: key.split(':')[0], question: entry.question, answer: entry.answer });
    while (state.messages.length > 100 || new TextEncoder().encode(JSON.stringify(state.messages)).length > 16 * 1024 * 1024) {
      state.messages.shift(); state.notice = 'Older displayed chat output was cleared to keep temporary memory bounded. Pending proposals are retained.';
    }
    state.remaining = state.remaining.filter(id => id !== entry.mediaId);
    state.proposals.push(...entry.proposals.map(proposal => ({ ...proposal, reviewTagIds: [...(proposal.patch.TagIds || [])], selectedFields: Object.keys(proposal.patch), overrideFields: [] })));
  }
  async function invoke(method, payload) {
    state.error = "";
    const response = await api[method](payload === undefined ? undefined : JSON.parse(JSON.stringify(payload)));
    if (!response.ok) throw new Error(response.error);
    return response.result;
  }
  async function action(work) { try { return await work(); } catch (error) { state.error = error.message; return null; } }
  function initialize() {
    unsubscribe = api.onAgentState(event => {
      if (event.sequence <= sequence) return; sequence = event.sequence;
      state.running = event.running; state.progress = event.progress;
      state.activeRunId = event.runId;
      if (event.streamReset) { state.partialMediaId = event.mediaId; state.partialAnswer = ''; }
      if (event.delta && state.partialMediaId === event.mediaId) state.partialAnswer += event.delta;
      if (event.completedItem?.mediaId === state.partialMediaId) state.partialAnswer = '';
      if (event.error) state.error = event.error;
      if (event.notice) state.notice = event.notice;
      if (event.completedItem) receive(event.completedItem, event.runId + ':' + event.completedItem.mediaId);
      if (event.verifiedItem && state.results?.resultSetId === event.verifiedItem.resultSetId) {
        const verified = event.verifiedItem.result;
        state.results.results = state.results.results.map(item => item.mediaId === verified.mediaId ? verified : item);
        state.remaining = state.remaining.filter(id => id !== verified.mediaId);
      }
    });
  }
  async function loadStatus() { return action(async () => { state.status = await invoke("agentStatus"); }); }
  async function toggle() { state.open = !state.open; state.preview = null; if (state.open) { state.mode = getView() === "viewer" ? "chat" : "search"; await loadStatus(); } }
  async function search(expand = false) {
    return action(async () => {
      state.depth = expand ? Math.min(10000, state.depth + 200) : 200;
      const epoch = requestEpoch; state.running = true;
      const query = expand ? state.searchQuestion : state.query;
      try { const results = await invoke("agentSearch", { query, local: state.local, scope: state.scope, galleryQuery: getQuery(), depth: state.depth, availableOnly: state.availableOnly, ...(expand ? { resultSetId: state.results.resultSetId } : {}) }); if (epoch === requestEpoch) { state.results = results; state.searchQuestion = query; if (state.query === query) state.query = ''; state.resultSelection = []; } }
      finally { state.running = false; }
    });
  }
  async function preview(continuing = false) {
    return action(async () => {
      const epoch = requestEpoch, kind = state.mode, query = continuing === true ? state.continuationQuery : state.query;
      const ticket = ++preparation, resultSetId = state.results?.resultSetId;
      const replaceTags = state.replaceTags;
      const remaining = [...(continuing === true ? state.remaining : selectedIds())];
      if (!remaining.length) throw new Error('Select media before previewing');
      const mediaIds = remaining.slice(0, state.mode === 'verify' ? 40 : 100);
      const preview = await invoke("agentPreview", { mediaIds, groups: state.groups, tagCatalogue: state.mode === 'verify' ? false : state.tagCatalogue });
      if (ticket !== preparation) return;
      if (epoch !== requestEpoch) throw new Error('Selection changed; send again');
      state.preview = { ...preview, remaining, kind, query, replaceTags, resultSetId };
    });
  }
  async function send() {
    if (!state.preview) return;
    const approved = state.preview; state.preview = null;
    state.continuationQuery = approved.query;
    state.activeQuestion = approved.query;
    state.remaining = approved.remaining;
    return action(async () => {
      const epoch = requestEpoch; state.running = true;
      try {
        if (approved.kind === 'verify') {
          const result = await invoke('agentVerify', { resultSetId: approved.resultSetId, mediaIds: approved.items.map(item => item.mediaId), groups: approved.groups, approvalId: approved.approvalId });
          if (epoch === requestEpoch && state.results?.resultSetId === result.resultSetId) {
            const updated = new Map(result.results.map(item => [item.mediaId, item]));
            state.results.results = state.results.results.map(item => updated.get(item.mediaId) || item);
            state.remaining = state.remaining.filter(id => !updated.has(id));
          }
          return;
        }
        const result = await invoke("agentChat", { query: approved.query, mediaIds: approved.items.map(item => item.mediaId), groups: approved.groups, tagCatalogue: approved.tagCatalogue, propose: approved.groups.includes('basic'), replaceTags: approved.replaceTags, approvalId: approved.approvalId });
        if (epoch !== requestEpoch) return;
        for (const entry of result.results) receive(entry, result.runId + ':' + entry.mediaId);
        if (state.query === approved.query) state.query = '';
      } finally { state.running = false; }
    });
  }
  async function submit(continuing = false) {
    if (state.submitting || state.running || state.applying) return;
    if (!continuing && state.mode !== 'verify' && !state.query.trim()) return;
    state.submitting = true; state.options = false; state.preview = null;
    try {
      if (state.mode === 'search') return await search();
      await preview(continuing);
      if (state.preview) await send();
    } finally { state.submitting = false; }
  }
  async function newChat() {
    if (state.running || state.submitting || state.applying) return;
    return action(async () => {
      const mediaIds = selectedIds();
      await invoke('agentClearChat', { mediaIds });
      state.messages = state.messages.filter(item => !mediaIds.includes(item.mediaId));
      Object.assign(state, { query: '', results: null, searchQuestion: '', partialAnswer: '', preview: null, remaining: [], options: false, notice: '' });
      if (state.proposals.length) state.notice = 'Pending suggested changes are retained for review.';
    });
  }
  async function apply(proposal) {
    if (state.applying) return;
    state.applying = true;
    try {
    return await action(async () => {
      const selections = (proposal ? [proposal] : state.proposals.filter(item => selectedIds().includes(item.mediaId))).filter(item => item.selectedFields.length);
      for (const item of selections) Object.assign(item, await invoke('agentRevise', { proposalId: item.proposalId, patch: item.patch }));
      if (getView() === "viewer") { acceptDraft(proposal); state.proposals = state.proposals.filter(item => item.proposalId !== proposal.proposalId); return; }
      await invoke("agentApply", { operationId: crypto.randomUUID(), selections: selections.map(item => ({ proposalId: item.proposalId, fields: item.selectedFields })) });
      const ids = new Set(selections.map(item => item.proposalId)); state.proposals = state.proposals.filter(item => !ids.has(item.proposalId)); await refresh();
    });
    } finally { state.applying = false; }
  }
  async function history() { return action(async () => { state.history = await invoke("agentHistory"); }); }
  async function discard(proposal) { return action(async () => { await invoke("agentDiscard", { proposalIds: [proposal.proposalId] }); state.proposals = state.proposals.filter(item => item.proposalId !== proposal.proposalId); }); }
  async function undo(operationId) {
    if (state.applying) return;
    state.applying = true;
    try { return await action(async () => { await invoke("agentUndo", { operationId }); await refresh(); await history(); }); }
    finally { state.applying = false; }
  }
  async function index(kind = "update") { return action(async () => { state.running = true; try { await invoke("agentIndex", { kind }); await loadStatus(); } finally { state.running = false; } }); }
  function reset() { requestEpoch++; delivered.clear(); Object.assign(state, { open: false, preview: null, running: false, results: null, messages: [], proposals: [], history: [], remaining: [], resultSelection: [], selectionFromResults: false, error: "", partialAnswer: '', partialMediaId: null }); }
  return { state, initialize, reset, dispose: () => { unsubscribe?.(); stopWatch(); }, toggle, search, preview, send, submit, newChat, apply, discard, history, undo, index, loadStatus, getMediaIds: selectedIds, getDraft, getMediaItem: id => getMediaItem(id) || state.results?.items?.find(item => item.MediaId === id),
    useResults: mode => { state.mode = mode; state.selectionFromResults = true; state.preview = null; },
    openMedia, cancel: () => action(() => invoke("agentCancel")),
    settingsAction: method => action(async () => { const result = await invoke(method); state.settingsResult = method === 'agentTestProvider' ? `Passed image, tool and transport test: ${result.model}` : 'Completed'; await loadStatus(); }),
  };
}
