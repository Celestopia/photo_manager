const path = require("node:path");
const cache = require("../../scripts/video-cover-cache.js");

function createVideoCoverService({ getLibrary, resolveMedia, appRoot, getConfig, log, generate = cache.generateCover }) {
  let current = null, tail = Promise.resolve(), paused = 0;
  async function checkSource(library, item, source) {
    await cache.checkCoverSource(library.paths, item, source);
  }
  async function stop() {
    current?.controller.abort();
    current = null;
    await tail;
  }
  async function exclusive(operation) {
    paused++;
    try { await stop(); return await operation(); } finally { paused--; }
  }
  async function request(payload) {
    const requestId = payload?.requestId, mediaId = payload?.mediaId;
    if (typeof requestId !== "string" || !/^[\w-]{1,100}$/.test(requestId) || typeof mediaId !== "string" || mediaId.length > 100)
      throw new Error("Invalid video cover request");
    const response = { requestId, mediaId };
    try {
      if (paused) return { ...response, status: "cancelled" };
      const library = getLibrary();
      const { item, absolutePath: source } = resolveMedia(mediaId);
      response.libraryId = library.manifest?.libraryId || library.sessionId;
      if (item.FileSystem.FileType !== "video") return { ...response, status: "unavailable" };
      const key = `${library.sessionId}:${item.SHA256Hash}`;
      if (!current || current.key !== key || current.controller.signal.aborted) {
        current?.controller.abort();
        const job = { key, controller: new AbortController(), requests: new Set() };
        const signal = job.controller.signal;
        job.promise = tail.then(async () => {
          signal.throwIfAborted();
          await checkSource(library, item, source);
          await cache.assertCacheDirectory(library.paths);
          const target = path.join(library.paths.videoCoverDir, cache.coverName(item.SHA256Hash));
          let bytes;
          try { bytes = await cache.readCover(target); } catch {
            signal.throwIfAborted();
            bytes = await generate({ paths: library.paths, source, hash: item.SHA256Hash, appRoot,
              config: getConfig(), signal, beforePublish: () => checkSource(library, item, source) });
          }
          signal.throwIfAborted();
          await checkSource(library, item, source);
          return `data:image/webp;base64,${bytes.toString("base64")}`;
        });
        tail = job.promise.catch(() => {});
        current = job;
      }
      const job = current;
      job.requests.add(requestId);
      await checkSource(library, item, source);
      const url = await job.promise;
      await checkSource(library, item, source);
      if (!job.requests.has(requestId) || job.controller.signal.aborted) return { ...response, status: "cancelled" };
      return { ...response, status: "ready", url };
    } catch (error) {
      if (error.name === "AbortError") return { ...response, status: "cancelled" };
      log(`Video cover ${mediaId}: ${error.code === "SOURCE_CHANGED" ? "source changed" : "unavailable"}`);
      return { ...response, status: error.code === "SOURCE_CHANGED" ? "source-changed" : "unavailable" };
    }
  }
  function cancel(requestId) {
    if (current?.requests.delete(requestId) && !current.requests.size) current.controller.abort();
  }
  return { request, cancel, stop, exclusive };
}
module.exports = { createVideoCoverService };
