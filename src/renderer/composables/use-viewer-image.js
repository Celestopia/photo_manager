import { computed, watch, onScopeDispose } from "vue";

/** Selected image loading is identical for photos and covers; neither path generates cache files. */
export function useViewerImage({ selectedItem, libraryState, view, orderedItems, createImage = () => new Image() }) {
  const imageUrl = computed(() => selectedItem.value?.__viewerImageUrl || "");
  let preloads = [];
  function clearPreloads() {
    for (const image of preloads) { image.onload = null; image.onerror = null; image.src = ""; }
    preloads = [];
  }
  watch([() => libraryState.value?.active?.libraryId, () => view.value], clearPreloads, { flush: "sync" });
  function imageLoaded(url) {
    if (url !== imageUrl.value || view.value !== "viewer") return;
    const previous = preloads;
    preloads = [];
    const items = orderedItems.value;
    const index = items.findIndex(item => item.MediaId === selectedItem.value?.MediaId);
    if (index < 0) { for (const image of previous) image.src = ""; return; }
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
      const retained = previous.find(image => image.src === item.__viewerImageUrl);
      if (retained) { preloads.push(retained); continue; }
      const image = createImage();
      image.decoding = "async";
      image.src = item.__viewerImageUrl;
      // Preload failures never generate covers or surface notices.
      void image.decode?.().catch(() => {});
      preloads.push(image);
    }
    for (const image of previous) if (!preloads.includes(image)) image.src = "";
  }
  onScopeDispose(clearPreloads);
  return { imageUrl, imageLoaded };
}
