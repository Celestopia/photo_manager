// Only attach to transient surfaces that already dismiss on outside interaction.
const documents = new WeakMap();
const entries = new WeakMap();

export default {
  beforeMount(element, binding) {
    const document = element.ownerDocument;
    let state = documents.get(document);
    if (!state) {
      state = { stack: [], key(event) {
        if (event.key !== 'Escape' || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229) return;
        const entry = state.stack.at(-1);
        if (!entry) return;
        const modal = document.activeElement?.closest('dialog[open], .tag-modal-backdrop');
        if (modal && !modal.contains(entry.element)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        entry.close();
        if (entry.trigger?.isConnected) entry.trigger.focus({ preventScroll: true });
      } };
      documents.set(document, state);
      document.addEventListener('keydown', state.key, true);
    }
    const entry = { element, close: binding.value, trigger: document.activeElement };
    entries.set(element, entry);
    state.stack.push(entry);
  },
  updated(element, binding) { entries.get(element).close = binding.value; },
  unmounted(element) {
    const document = element.ownerDocument;
    const state = documents.get(document);
    state.stack.splice(state.stack.indexOf(entries.get(element)), 1);
    entries.delete(element);
    if (!state.stack.length) {
      document.removeEventListener('keydown', state.key, true);
      documents.delete(document);
    }
  },
};
