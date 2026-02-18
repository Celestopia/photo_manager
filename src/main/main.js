/**
 * Electron main-process entry.
 *
 * Responsibilities:
 * 1) Load and normalize runtime configuration.
 * 2) Load photo metadata index (JSONL -> in-memory Map).
 * 3) Serve IPC handlers for query/update/copy/window actions.
 * 4) Create and monitor the renderer window.
 */
const { app, BrowserWindow, ipcMain, clipboard, nativeImage } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const yaml = require("js-yaml");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_PATH = path.join(APP_ROOT, "config.yml");

const DEFAULT_CONFIG = {
  workspaceRoot: "./photo_workspace",
  metadataFile: "./photo_metadata.jsonl",
  logDir: "./logs",
  ui: {
    language: "zh-CN",
    gallery: {
      pageSize: 120,
      minCardWidth: 190,
    },
    viewer: {
      panelRatio: {
        left: 1,
        center: 3,
        right: 1,
      },
      panels: {
        showLeft: true,
        showRight: true,
      },
      zoom: {
        minPercent: 10,
        maxPercent: 1000,
        stepPercent: 10,
      },
    },
  },
};

// Runtime singletons in the main process.
let mainWindow = null;
let config = null;
let metadataIndex = new Map();

/**
 * Force value into plain JSON-serializable structure.
 * This avoids IPC structured-clone failures when Vue/reactive objects leak in.
 */
function toSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Ensure config exists and always produce a fully merged config object.
 * If config file is invalid, fallback to defaults and log the issue.
 */
function ensureConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, yaml.dump(DEFAULT_CONFIG), "utf8");
    config = structuredClone(DEFAULT_CONFIG);
    return;
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = yaml.load(raw);
    config = {
      ...DEFAULT_CONFIG,
      ...parsed,
      ui: {
        ...DEFAULT_CONFIG.ui,
        ...(parsed?.ui || {}),
        gallery: {
          ...DEFAULT_CONFIG.ui.gallery,
          ...(parsed?.ui?.gallery || {}),
        },
        viewer: {
          ...DEFAULT_CONFIG.ui.viewer,
          ...(parsed?.ui?.viewer || {}),
          panelRatio: {
            ...DEFAULT_CONFIG.ui.viewer.panelRatio,
            ...(parsed?.ui?.viewer?.panelRatio || {}),
          },
          panels: {
            ...DEFAULT_CONFIG.ui.viewer.panels,
            ...(parsed?.ui?.viewer?.panels || {}),
          },
          zoom: {
            ...DEFAULT_CONFIG.ui.viewer.zoom,
            ...(parsed?.ui?.viewer?.zoom || {}),
          },
        },
      },
    };
  } catch (error) {
    config = structuredClone(DEFAULT_CONFIG);
    appendLog(`Invalid config.yml, fallback to default. ${error.message}`);
  }
}

/**

 * Check whether a value is a plain object (object literal style).

 * Used by deepMerge to avoid recursing into arrays or primitive values.

 */

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

/**

 * Recursively merge patch fields into a base object.

 * This keeps nested config sections intact when updating only part of config.yml.

 */

function deepMerge(base, patch) {
  const output = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

/**

 * Persist current in-memory config to config.yml.

 * Called after app:update-config succeeds in merging a patch.

 */

async function saveConfig() {
  const raw = yaml.dump(config);
  await fsp.writeFile(CONFIG_PATH, raw, "utf8");
}

/**
 * Resolve project-relative path to absolute path.
 */
function toAbsolutePath(possibleRelativePath) {
  if (path.isAbsolute(possibleRelativePath)) {
    return possibleRelativePath;
  }
  return path.resolve(APP_ROOT, possibleRelativePath);
}

/**
 * Append one line into date-partitioned log file under configured log directory.
 */
function appendLog(message) {
  try {
    const logDir = toAbsolutePath(config?.logDir || DEFAULT_CONFIG.logDir);
    fs.mkdirSync(logDir, { recursive: true });
    const dayKey = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(path.join(logDir, `${dayKey}.log`), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Ignore logging failures to avoid crash loops.
  }
}

/**
 * Read metadata JSONL into an in-memory Map keyed by FilePath.
 * Invalid lines are skipped so a partially broken metadata file does not block startup.
 */
async function loadMetadataIndex() {
  metadataIndex.clear();
  const metadataFile = toAbsolutePath(config.metadataFile);

  if (!fs.existsSync(metadataFile)) {
    return;
  }

  const content = await fsp.readFile(metadataFile, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item?.FilePath) {
        metadataIndex.set(item.FilePath, item);
      }
    } catch (error) {
      appendLog(`Skip invalid metadata line: ${error.message}`);
    }
  }
}

/**
 * Apply gallery-level filtering/searching/sorting in memory.
 * Filter semantics match the requirement document:
 * - hidden items are excluded
 * - Album/Tag filters are intersected
 * - search is exact substring matching
 */
function filterAndSort(list, options) {
  const { filters, search, sortBy, sortOrder } = options;

  let output = list.filter((item) => !item?.Customization?.Hidden);

  if (filters.album) {
    output = output.filter((item) => item?.Customization?.Album === filters.album);
  }

  if (filters.tag) {
    output = output.filter((item) => Array.isArray(item?.Customization?.Tags) && item.Customization.Tags.includes(filters.tag));
  }

  if (search?.value && search?.field) {
    output = output.filter((item) => {
      const keyword = search.value;
      const fieldValue = (() => {
        if (search.field === "title") return item?.Customization?.Title || "";
        if (search.field === "filename") return path.basename(item?.FilePath || "");
        if (search.field === "description") return item?.Customization?.Description || "";
        return "";
      })();
      return fieldValue.includes(keyword);
    });
  }

  output.sort((a, b) => {
    let va;
    let vb;

    if (sortBy === "filename") {
      va = path.basename(a.FilePath || "");
      vb = path.basename(b.FilePath || "");
    } else if (sortBy === "rating") {
      va = a?.Customization?.Rating || 0;
      vb = b?.Customization?.Rating || 0;
    } else {
      va = a?.FileSystem?.ShootingTimeString || "";
      vb = b?.FileSystem?.ShootingTimeString || "";
    }

    if (va < vb) return sortOrder === "asc" ? -1 : 1;
    if (va > vb) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  return output;
}

/**
 * Inject renderer-facing helper fields:
 * - absolute file path for image loading/copy
 * - date grouping key for gallery sections
 */
function enrichItem(item) {
  const workspaceRoot = toAbsolutePath(config.workspaceRoot);
  const absPath = path.join(workspaceRoot, item.FilePath);
  return {
    ...item,
    __absolutePath: absPath,
    __groupDate: (item?.FileSystem?.ShootingTimeString || "").slice(0, 10) || "Unknown",
  };
}

/**
 * Persist full metadata Map back to JSONL using atomic replace:
 * write temp file -> rename.
 */
async function saveMetadataMap() {
  const metadataFile = toAbsolutePath(config.metadataFile);
  const tempFile = `${metadataFile}.tmp`;
  const lines = [...metadataIndex.values()].map((item) => JSON.stringify(item));
  await fsp.writeFile(tempFile, `${lines.join("\n")}${lines.length ? "\n" : ""}`, "utf8");
  await fsp.rename(tempFile, metadataFile);
}

/**
 * Register all IPC endpoints used by renderer.
 * Channels are intentionally explicit to keep the API surface narrow and auditable.
 */
function registerIpcHandlers() {
  ipcMain.handle("app:get-config", async () => toSerializable(config));
  ipcMain.handle("app:update-config", async (_, patch) => {
    try {
      config = deepMerge(config, patch || {});
      await saveConfig();
      return { ok: true, config: toSerializable(config) };
    } catch (error) {
      appendLog(`Failed to update config: ${error.message}`);
      return { ok: false, error: "Failed to update config" };
    }
  });

  ipcMain.handle("gallery:query", async (_, query) => {
    const all = [...metadataIndex.values()].map(enrichItem);
    const filtered = filterAndSort(all, query);

    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.max(1, Number(query.pageSize || config.ui.gallery.pageSize));
    const start = (page - 1) * pageSize;
    const pageItems = filtered.slice(start, start + pageSize);

    const grouped = new Map();
    for (const item of pageItems) {
      if (!grouped.has(item.__groupDate)) {
        grouped.set(item.__groupDate, []);
      }
      grouped.get(item.__groupDate).push(item);
    }

    // Pagination happens after filter/sort to keep UI behavior consistent.
    const payload = {
      total: filtered.length,
      page,
      pageSize,
      hasMore: start + pageSize < filtered.length,
      groups: [...grouped.entries()].map(([date, items]) => ({ date, items })),
      filterOptions: {
        albums: [...new Set(all.map((item) => item?.Customization?.Album).filter(Boolean))].sort(),
        tags: [...new Set(all.flatMap((item) => item?.Customization?.Tags || []).filter(Boolean))].sort(),
      },
    };
    return toSerializable(payload);
  });

  ipcMain.handle("photo:update-customization", async (_, payload) => {
    const { filePath, customization, location } = payload;
    const current = metadataIndex.get(filePath);

    if (!current) {
      return { ok: false, error: "Metadata item not found" };
    }

    // Merge user edits and stamp update time.
    current.Customization = {
      ...current.Customization,
      ...customization,
      MetadataUpdateDate: new Date().toISOString(),
    };
    delete current.Customization.Category;
    current.Location = {
      ...(current.Location || {}),
      ...(location || {}),
    };

    metadataIndex.set(filePath, current);

    try {
      await saveMetadataMap();
      return toSerializable({ ok: true, item: enrichItem(current) });
    } catch (error) {
      appendLog(`Failed to write metadata: ${error.message}`);
      return { ok: false, error: "Failed to write metadata" };
    }
  });

  ipcMain.handle("photo:batch-update", async (_, payload) => {
    const filePaths = Array.isArray(payload?.filePaths) ? payload.filePaths : [];
    const addTags = Array.isArray(payload?.addTags) ? payload.addTags : [];
    const locationPatch = payload?.locationPatch && typeof payload.locationPatch === "object" ? payload.locationPatch : {};
    const customizationPatch = payload?.customizationPatch && typeof payload.customizationPatch === "object" ? payload.customizationPatch : {};

    if (!filePaths.length) {
      return { ok: false, error: "No target file paths" };
    }

    const locationKeys = ["Country", "Province", "City", "Site"];
    const dedupTags = [...new Set(addTags.map((x) => String(x || "").trim()).filter(Boolean))];
    const updatedItems = [];
    const requestedCount = filePaths.length;
    let missingCount = 0;

    for (const filePath of filePaths) {
      const current = metadataIndex.get(filePath);
      if (!current) {
        missingCount += 1;
        continue;
      }

      const currentTags = Array.isArray(current?.Customization?.Tags) ? current.Customization.Tags : [];
      const mergedTags = [...currentTags];
      for (const tag of dedupTags) {
        if (!mergedTags.includes(tag)) mergedTags.push(tag);
      }

      current.Customization = {
        ...current.Customization,
        ...customizationPatch,
        Tags: mergedTags,
        MetadataUpdateDate: new Date().toISOString(),
      };
      delete current.Customization.Category;

      current.Location = {
        ...(current.Location || {}),
      };
      for (const key of locationKeys) {
        if (Object.prototype.hasOwnProperty.call(locationPatch, key)) {
          current.Location[key] = String(locationPatch[key] ?? "");
        }
      }

      metadataIndex.set(filePath, current);
      updatedItems.push(enrichItem(current));
    }

    try {
      if (updatedItems.length) await saveMetadataMap();
      return toSerializable({
        ok: true,
        requestedCount,
        updatedCount: updatedItems.length,
        missingCount,
        items: updatedItems,
      });
    } catch (error) {
      appendLog(`Failed to batch-write metadata: ${error.message}`);
      return { ok: false, error: "Failed to write metadata" };
    }
  });

  ipcMain.handle("photo:copy-path", async (_, absolutePath) => {
    clipboard.writeText(absolutePath);
    return { ok: true };
  });

  ipcMain.handle("photo:copy-json", async (_, item) => {
    clipboard.writeText(JSON.stringify(item, null, 2));
    return { ok: true };
  });

  ipcMain.handle("photo:copy-image", async (_, absolutePath) => {
    const image = nativeImage.createFromPath(absolutePath);
    if (image.isEmpty()) {
      return { ok: false, error: "Image load failed" };
    }
    clipboard.writeImage(image);
    return { ok: true };
  });

  ipcMain.handle("window:action", async (_, action) => {
    if (!mainWindow) return;
    if (action === "minimize") mainWindow.minimize();
    if (action === "maximize") mainWindow.maximize();
    if (action === "restore") mainWindow.unmaximize();
    if (action === "close") mainWindow.close();
  });

  ipcMain.handle("window:get-state", async () => ({
    isMaximized: Boolean(mainWindow?.isMaximized()),
  }));
}

/**
 * App bootstrap sequence:
 * 1) load config
 * 2) load metadata index
 * 3) create BrowserWindow
 * 4) bind renderer diagnostics hooks
 * 5) load renderer entry HTML
 */
async function bootstrap() {
  ensureConfig();
  await loadMetadataIndex();

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep sandbox disabled for this local desktop app setup to ensure
      // preload bridge works consistently in current environment.
      sandbox: false,
    },
  });

  // Renderer diagnostics: helps investigate blank-screen and startup issues quickly.
  mainWindow.webContents.on("did-fail-load", (_, errorCode, errorDescription, validatedURL) => {
    const msg = `did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedURL}`;
    console.error(msg);
    appendLog(msg);
  });

  mainWindow.webContents.on("render-process-gone", (_, details) => {
    const msg = `render-process-gone reason=${details?.reason} exitCode=${details?.exitCode}`;
    console.error(msg);
    appendLog(msg);
  });

  mainWindow.webContents.on("unresponsive", () => {
    const msg = "renderer became unresponsive";
    console.error(msg);
    appendLog(msg);
  });

  mainWindow.webContents.on("console-message", (_, level, message, line, sourceId) => {
    const msg = `renderer-console [${level}] ${message} @ ${sourceId}:${line}`;
    console.log(msg);
    appendLog(msg);
  });

  const emitWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("window:state-changed", {
      isMaximized: mainWindow.isMaximized(),
    });
  };
  mainWindow.on("maximize", emitWindowState);
  mainWindow.on("unmaximize", emitWindowState);
  mainWindow.on("enter-full-screen", emitWindowState);
  mainWindow.on("leave-full-screen", emitWindowState);

  await mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  emitWindowState();
}

// Standard Electron lifecycle.
app.whenReady().then(async () => {
  registerIpcHandlers();
  await bootstrap();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await bootstrap();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
