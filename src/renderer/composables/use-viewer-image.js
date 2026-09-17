import { computed, watch, onScopeDispose } from "vue";

/** Selected image loading is identical for photos and covers; only failed covers request repair. */
export function useViewerImage({ api, selectedItem, libraryState, view, orderedItems, createImage = () => new Image() }) {
  const imageUrl = computed(() => selectedItem.value?.__viewerImageUrl || "");
  let requestId = "", attempted = false, generation = 0;
  let preloads = [];
  function clearPreloads() {
    for (const image of preloads) { image.onload = null; image.onerror = null; image.src = ""; }
    preloads = [];
  }
  function cancel() {
    generation++;
    if (requestId) void api.cancel(requestId).catch(() => {});
    requestId = "";
    attempted = false;
    clearPreloads();
  }
  watch([() => libraryState.value?.active?.libraryId, () => view.value,
    () => selectedItem.value?.MediaId], cancel, { flush: "sync" });
  watch(() => selectedItem.value?.__viewerImageUrl, clearPreloads, { flush: "sync" });
  async function imageFailed(failedUrl) {
    const item = selectedItem.value;
    if (failedUrl !== imageUrl.value || view.value !== "viewer" || item?.FileSystem?.FileType !== "video" || attempted) return;
    attempted = true;
    const token = generation;
    requestId = crypto.randomUUID();
    const id = requestId;
    try {
      const result = await api.request({ requestId: id, mediaId: item.MediaId });
      if (generation !== token || result.requestId !== id || result.mediaId !== item.MediaId
        || result.libraryId !== libraryState.value?.active?.libraryId) return;
      if (result.status === "ready") {
        const revision = new URL(result.url).search;
        for (const candidate of [item, ...orderedItems.value]) {
          if (candidate.SHA256Hash === item.SHA256Hash && candidate.__viewerImageUrl)
            candidate.__viewerImageUrl = candidate.__viewerImageUrl.split("?")[0] + revision;
        }
      }
    } catch { /* Keep the neutral error surface; no retry loop. */ }
  }
  function imageLoaded(url) {
    if (url !== imageUrl.value || view.value !== "viewer") return;
    clearPreloads();
    const items = orderedItems.value;
    const index = items.findIndex(item => item.MediaId === selectedItem.value?.MediaId);
    if (index < 0) return;
    // At most two adjacent images, conservatively bounded to 64 MiB of decoded pixels.
    let pixelsLeft = 16 * 1024 * 1024;
    for (const item of [items[index + 1], items[index - 1]]) {
      if (!item?.__viewerImageUrl) continue;
      const video = item.FileSystem?.FileType === "video";
      const width = Number(video ? item.Video?.DisplayWidth : item.Picture?.Width);
      const height = Number(video ? item.Video?.DisplayHeight : item.Picture?.Height);
      const scale = video ? Math.min(1, 2560 / Math.max(width, height)) : 1;
      const pixels = Math.ceil(width * height * scale * scale);
      if (!(pixels > 0) || pixels > pixelsLeft) continue;
      pixelsLeft -= pixels;
      const image = createImage();
      image.decoding = "async";
      image.src = item.__viewerImageUrl;
      // Preload failures never generate covers or surface notices.
      void image.decode?.().catch(() => {});
      preloads.push(image);
    }
  }
  onScopeDispose(cancel);
  return { imageUrl, imageFailed, imageLoaded };
}
