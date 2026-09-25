import { reactive } from "vue";

// One pending decision per window. A second request never approves an action.
export function useAppDialog() {
  const state = reactive({ visible: false, title: "", message: "", path: "", confirmLabel: "Continue", cancelLabel: "Cancel", danger: false, notice: false });
  let resolvePending;
  function settle(accepted = false) {
    const resolve = resolvePending;
    resolvePending = null;
    state.visible = false;
    resolve?.(accepted === true);
  }
  function request(options) {
    if (resolvePending) return Promise.resolve(false);
    Object.assign(state, { path: "", confirmLabel: "Continue", cancelLabel: "Cancel", danger: false, notice: false }, options, { visible: true });
    return new Promise(resolve => { resolvePending = resolve; });
  }
  return { state, request, settle, reset: () => settle(false) };
}
