/**
 * Lightweight static server for browser preview mode.
 *
 * This server intentionally has no framework dependency.
 * It only serves project files for local UI debugging.
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "text/plain; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

// Resolve URL path safely under project root (path traversal protected).
/**
 * Resolve request URL to a safe absolute file path inside project root.
 * Rejects path traversal attempts by validating resolved prefix.
 */
function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const clean = decoded;
  const abs = path.resolve(ROOT, `.${clean}`);
  if (!abs.startsWith(ROOT)) return null;
  return abs;
}

const server = http.createServer(async (req, res) => {
  try {
    // Browser preview entry is built into dist/renderer.
    const urlPath = (req.url || "/").split("?")[0];
    if (urlPath === "/" || urlPath === "/browser.html") {
      res.writeHead(302, { Location: "/dist/renderer/browser.html" });
      res.end();
      return;
    }

    const filePath = safePath(req.url || "/");
    if (!filePath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const st = await fsp.stat(filePath).catch(() => null);
    if (!st || st.isDirectory()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(500);
    res.end(`Internal error: ${error.message}`);
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Try: set PORT=5174 && npm run start:web`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, () => {
  console.log(`Browser preview ready: http://localhost:${PORT}`);
  console.log("Open the URL in your browser.");
});
