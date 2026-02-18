/**
 * Browser preview bridge (mock implementation of photoManagerApi).
 *
 * Purpose:
 * - Let the same Vue UI run without Electron.
 * - Read metadata and images over local HTTP static server.
 * - Keep interface shape close to Electron preload API.
 */
(function () {
  const DEFAULT_CONFIG = {
    workspaceRoot: "./photo_workspace",
    metadataFile: "./photo_metadata.jsonl",
    thumbnail: {
      dir: "./thumb_cache",
      size: 320,
      webpQuality: 80,
      extremeAspectRatio: 4,
      maxConcurrency: 4,
    },
    ui: {
      gallery: { pageSize: 120, minCardWidth: 190 },
      viewer: {
        panelRatio: { left: 1, center: 2, right: 1 },
        zoom: { minPercent: 10, maxPercent: 1000, stepPercent: 10 },
      },
    },
  };

  // Metadata cache for the current browser session.
  let cache = [];

  /**

   * Sort helper for metadata records by shooting time (newest first).

   * Used to keep browser preview ordering consistent with desktop mode.

   */

  function byDateDesc(a, b) {
    const va = a?.FileSystem?.ShootingTimeString || "";
    const vb = b?.FileSystem?.ShootingTimeString || "";
    if (va < vb) return 1;
    if (va > vb) return -1;
    return 0;
  }

  /**

   * Lazy-load metadata JSONL and build in-memory records for browser preview mode.

   * Also injects renderer helper fields (__absolutePath/__thumbnailPath/__groupDate).

   */

  async function loadMetadata() {
    // Lazy-load and parse JSONL only once per page lifecycle.
    if (cache.length) return cache;
    const text = await fetch("/photo_metadata.jsonl").then((r) => r.text());
    cache = text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .sort(byDateDesc)
      .map((item) => ({
        ...item,
        __absolutePath: `/photo_workspace/${item.FilePath}`,
        __thumbnailPath: item?.SHA256Hash ? `/thumb_cache/${item.SHA256Hash}.webp` : "",
        __groupDate: (item?.FileSystem?.ShootingTimeString || "").slice(0, 10) || "Unknown",
      }));
    return cache;
  }

  /**

   * Apply gallery filters, search conditions, and sorting to the cached list.

   * The behavior intentionally mirrors main-process query logic for UI parity.

   */

  function filterAndSort(list, options) {
    const { filters, search, sortBy, sortOrder } = options;
    let output = list.filter((item) => !item?.Customization?.Hidden);

    if (filters.album) output = output.filter((item) => item?.Customization?.Album === filters.album);
    if (filters.tag) output = output.filter((item) => (item?.Customization?.Tags || []).includes(filters.tag));

    if (search?.field && search?.value) {
      output = output.filter((item) => {
        let source = "";
        if (search.field === "title") source = item?.Customization?.Title || "";
        if (search.field === "filename") source = (item?.FilePath || "").split("/").pop() || "";
        if (search.field === "description") source = item?.Customization?.Description || "";
        return source.includes(search.value);
      });
    }

    output.sort((a, b) => {
      let va = "";
      let vb = "";
      if (sortBy === "filename") {
        va = (a?.FilePath || "").split("/").pop() || "";
        vb = (b?.FilePath || "").split("/").pop() || "";
      } else if (sortBy === "rating") {
        va = Number(a?.Customization?.Rating || 0);
        vb = Number(b?.Customization?.Rating || 0);
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

  window.photoManagerApi = {
    async getConfig() {
      // Browser mode uses in-file defaults; no config.yml parsing.
      return DEFAULT_CONFIG;
    },
    async queryGallery(query) {
      const all = await loadMetadata();
      const filtered = filterAndSort(all, query);
      const page = Math.max(1, Number(query.page || 1));
      const pageSize = Math.max(1, Number(query.pageSize || 120));
      const start = (page - 1) * pageSize;
      const pageItems = filtered.slice(start, start + pageSize);

      const grouped = new Map();
      for (const item of pageItems) {
        if (!grouped.has(item.__groupDate)) grouped.set(item.__groupDate, []);
        grouped.get(item.__groupDate).push(item);
      }

      return {
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
    },
    async updateCustomization(payload) {
      // Browser mode updates in memory only; it does not write back to disk.
      const all = await loadMetadata();
      const idx = all.findIndex((x) => x.FilePath === payload.filePath);
      if (idx < 0) return { ok: false, error: "Item not found" };
      all[idx].Customization = {
        ...all[idx].Customization,
        ...payload.customization,
        MetadataUpdateDate: new Date().toISOString(),
      };
      delete all[idx].Customization.Category;
      all[idx].Location = {
        ...(all[idx].Location || {}),
        ...(payload.location || {}),
      };
      return { ok: true, item: all[idx] };
    },
    async batchUpdateMetadata(payload) {
      const all = await loadMetadata();
      const filePaths = Array.isArray(payload?.filePaths) ? payload.filePaths : [];
      const addTags = [...new Set((payload?.addTags || []).map((x) => String(x || "").trim()).filter(Boolean))];
      const locationPatch = payload?.locationPatch && typeof payload.locationPatch === "object" ? payload.locationPatch : {};
      const customizationPatch = payload?.customizationPatch && typeof payload.customizationPatch === "object" ? payload.customizationPatch : {};
      const locationKeys = ["Country", "Province", "City", "Site"];
      const items = [];
      const requestedCount = filePaths.length;
      let missingCount = 0;

      for (const filePath of filePaths) {
        const idx = all.findIndex((x) => x.FilePath === filePath);
        if (idx < 0) {
          missingCount += 1;
          continue;
        }

        const currentTags = Array.isArray(all[idx]?.Customization?.Tags) ? all[idx].Customization.Tags : [];
        const mergedTags = [...currentTags];
        for (const tag of addTags) {
          if (!mergedTags.includes(tag)) mergedTags.push(tag);
        }

        all[idx].Customization = {
          ...all[idx].Customization,
          ...customizationPatch,
          Tags: mergedTags,
          MetadataUpdateDate: new Date().toISOString(),
        };
        delete all[idx].Customization.Category;

        all[idx].Location = {
          ...(all[idx].Location || {}),
        };
        for (const key of locationKeys) {
          if (Object.prototype.hasOwnProperty.call(locationPatch, key)) {
            all[idx].Location[key] = String(locationPatch[key] ?? "");
          }
        }
        items.push(all[idx]);
      }

      return { ok: true, requestedCount, updatedCount: items.length, missingCount, items };
    },
    async copyPath(p) {
      if (navigator.clipboard) await navigator.clipboard.writeText(p);
      return { ok: true };
    },
    async copyJson(item) {
      if (navigator.clipboard) await navigator.clipboard.writeText(JSON.stringify(item, null, 2));
      return { ok: true };
    },
    async copyImage() {
      // Clipboard image write is Electron-specific in current implementation.
      return { ok: false, error: "Browser mode does not support image clipboard copy." };
    },
    async windowAction() {
      return { ok: true };
    },
    async getWindowState() {
      return { isMaximized: false };
    },
    onWindowStateChanged() {
      return () => {};
    },
  };
})();
