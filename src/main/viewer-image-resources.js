const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { assertCacheDirectory, checkCoverSource, coverName } = require("../core/video-cover-cache");

const owners = new Map();
const SCHEME = "viewer-image";
let schemeRegistered = false;
function registerViewerImageScheme(protocol) {
  if (schemeRegistered) return;
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  schemeRegistered = true;
}
function createViewerImageResources({ getLibrary, getItem, fetchFile }) {
  let token = "", sessionId = "";
  const readers = new Set();
  function invalidate() {
    for (const reader of readers) reader.abort();
    readers.clear();
    owners.delete(token);
    token = "";
    sessionId = "";
  }
  function urlFor(item) {
    const library = getLibrary();
    if (!library || library.state !== "open") return "";
    if (sessionId !== library.sessionId || !token) {
      invalidate();
      sessionId = library.sessionId;
      token = randomBytes(24).toString("hex");
      owners.set(token, serve);
    }
    return `${SCHEME}://${token}/${encodeURIComponent(item.MediaId)}?v=${item.SHA256Hash}`;
  }
  async function serve(request) {
    const library = getLibrary();
    if (!library || library.state !== "open") return new Response(null, { status: 410 });
    const url = new URL(request.url);
    const item = getItem(decodeURIComponent(url.pathname.slice(1)));
    if (!item || urlFor(item) !== request.url) return new Response(null, { status: 404 });
    const source = path.resolve(library.paths.root, item.FilePath);
    await checkCoverSource(library.paths, item, source);
    let file = source;
    if (item.FileSystem.FileType === "video") {
      await assertCacheDirectory(library.paths);
      file = path.join(library.paths.videoCoverDir, coverName(item.SHA256Hash));
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) return new Response(null, { status: 404 });
    }
    // Check again after async filesystem work; revoked resources cannot start a read.
    if (getLibrary() !== library || url.hostname !== token || library.state !== "open") return new Response(null, { status: 410 });
    const controller = new AbortController();
    readers.add(controller);
    let response;
    try { response = await fetchFile(pathToFileURL(file).href, { signal: controller.signal }); }
    catch (error) { readers.delete(controller); throw error; }
    const reader = response.body?.getReader();
    const body = reader ? new ReadableStream({
      async pull(output) {
        try {
          const chunk = await reader.read();
          if (chunk.done) { readers.delete(controller); output.close(); }
          else output.enqueue(chunk.value);
        } catch (error) { readers.delete(controller); output.error(error); }
      },
      cancel(reason) { readers.delete(controller); controller.abort(); return reader.cancel(reason); },
    }) : null;
    if (!reader) readers.delete(controller);
    return new Response(body, { status: response.status, headers: {
      "Content-Type": response.headers.get("content-type") || (item.FileSystem.FileType === "video" ? "image/webp" : "application/octet-stream"),
      "Cache-Control": "private, max-age=31536000, immutable",
    } });
  }
  return { urlFor, invalidate };
}
async function handleViewerImageRequest(request) {
  try {
    if (request.method !== "GET") return new Response(null, { status: 405 });
    const url = new URL(request.url);
    const owner = url.protocol === `${SCHEME}:` && owners.get(url.hostname);
    if (!owner) return new Response(null, { status: 404 });
    return await owner(request);
  } catch { return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } }); }
}
module.exports = { SCHEME, registerViewerImageScheme, createViewerImageResources, handleViewerImageRequest };
