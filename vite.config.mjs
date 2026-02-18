import { resolve } from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

function redirectRootToBrowserHtml() {
  const handler = (req, res, next) => {
    const url = req.url || "/";
    if (url === "/" || url.startsWith("/?")) {
      res.statusCode = 302;
      res.setHeader("Location", "/browser.html");
      res.end();
      return;
    }
    next();
  };

  return {
    name: "redirect-root-to-browser-html",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, "src", "renderer"),
  // Electron loads dist HTML via file://, so assets must use relative URLs.
  base: "./",
  plugins: [vue(), redirectRootToBrowserHtml()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, "dist", "renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "src", "renderer", "index.html"),
        browser: resolve(__dirname, "src", "renderer", "browser.html"),
      },
    },
  },
});
