import { ref, watch } from "vue";

export function useVideoCover({ api, selectedItem, libraryState, view, hasVideoPlaybackStarted }) {
  const videoCoverUrl = ref("");
  const videoPosterUrl = ref("");
  watch([() => libraryState.value?.active?.libraryId, () => view.value, () => selectedItem.value?.MediaId],
    async ([libraryId, currentView, mediaId], _, onCleanup) => {
      videoCoverUrl.value = "";
      videoPosterUrl.value = "";
      if (currentView !== "viewer" || selectedItem.value?.FileSystem?.FileType !== "video") return;
      const requestId = crypto.randomUUID();
      let cancelled = false;
      onCleanup(() => { cancelled = true; void api.cancel(requestId).catch(() => {}); });
      try {
        const result = await api.request({ requestId, mediaId });
        if (cancelled || result.requestId !== requestId || result.mediaId !== mediaId || result.libraryId !== libraryId) return;
        if (result.status === "ready") {
          videoCoverUrl.value = result.url;
          if (!hasVideoPlaybackStarted.value) videoPosterUrl.value = result.url;
        }
      } catch { /* Cover failure must not interrupt playback. */ }
    }, { immediate: true });
  return { videoCoverUrl, videoPosterUrl };
}
