import { ref, onMounted, onScopeDispose } from "vue";
export function useSemanticIndex(api) {
  const status = ref(null),
    busy = ref(false),
    error = ref(""),
    progress = ref(null);
  let alive = true;
  const unsubscribe = api.onProgress((p) => {
    if (alive) progress.value = p;
  });
  async function refresh() {
    error.value = "";
    try {
      const next = await api.status();
      if (alive) status.value = next;
    } catch (e) {
      if (alive) error.value = e.message;
    }
  }
  async function install(mode) {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    try {
      await api.install(mode);
      if (alive) await refresh();
    } catch (e) {
      if (alive) error.value = e.message;
    } finally {
      if (alive) busy.value = false;
    }
  }
  onMounted(refresh);
  onScopeDispose(() => {
    alive = false;
    unsubscribe();
    if (busy.value) void api.cancel();
  });
  return {
    status,
    busy,
    error,
    progress,
    refresh,
    install,
    cancel: () => api.cancel(),
  };
}
