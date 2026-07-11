import { resolve } from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  root: resolve(__dirname, "src", "renderer"),
  // Electron loads dist HTML via file://, so assets must use relative URLs.
  base: "./",
  plugins: [vue()],
  build: {
    outDir: resolve(__dirname, "dist", "renderer"),
    emptyOutDir: true,
  },
});
