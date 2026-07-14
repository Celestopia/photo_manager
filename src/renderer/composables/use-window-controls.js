import { computed, ref } from "vue";

/** Owns custom title-bar state and the main-process window-state subscription. */
export function useWindowControls({ api, icons, actions }) {
  const isWindowMaximized = ref(false);
  const windowToggleTip = computed(() => (isWindowMaximized.value ? "还原" : "最大化"));
  const windowToggleIcon = computed(() => (isWindowMaximized.value ? icons.windowRestore : icons.windowMaximize));
  let removeWindowStateListener = null;

  async function refreshWindowState() {
    if (typeof api.getWindowState !== "function") return;
    const state = await api.getWindowState();
    isWindowMaximized.value = Boolean(state?.isMaximized);
  }

  async function initialize() {
    await refreshWindowState();
    if (typeof api.onWindowStateChanged === "function") {
      removeWindowStateListener = api.onWindowStateChanged((state) => {
        isWindowMaximized.value = Boolean(state?.isMaximized);
      });
    }
  }

  async function doWindowAction(action) {
    await api.windowAction(action);
  }

  async function toggleWindowMaximizeRestore() {
    await doWindowAction(isWindowMaximized.value ? actions.restore : actions.maximize);
    await refreshWindowState();
  }

  function dispose() {
    if (typeof removeWindowStateListener === "function") removeWindowStateListener();
    removeWindowStateListener = null;
  }

  return {
    isWindowMaximized,
    windowToggleTip,
    windowToggleIcon,
    initialize,
    dispose,
    doWindowAction,
    toggleWindowMaximizeRestore,
  };
}
