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
    tagRegistryFile: "./tag_registry.jsonl",
    albumRegistryFile: "./album_registry.jsonl",
    personRegistryFile: "./person_registry.jsonl",
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
  const DEFAULT_TAG_DESCRIPTION = "待补充：请填写该标签的明确含义。";
  const DEFAULT_ALBUM_DESCRIPTION = "待补充：请填写该相册的明确含义。";
  const UNASSIGNED_ALBUM_FILTER = "__UNASSIGNED__";

  // Metadata cache for the current browser session.
  let cache = [];
  let tagRegistry = null;
  let albumRegistry = null;
  let personRegistry = null;

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

  function normalizeTagText(value) {
    return String(value ?? "").trim();
  }

  function tagUsageCounts() {
    const counts = new Map();
    for (const item of cache) {
      const tags = Array.isArray(item?.Customization?.Tags) ? item.Customization.Tags : [];
      for (const rawTag of tags) {
        const tag = normalizeTagText(rawTag);
        if (!tag) continue;
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return counts;
  }

  function seedTagRegistryFromMetadata() {
    const now = new Date().toISOString();
    for (const item of cache) {
      const tags = Array.isArray(item?.Customization?.Tags) ? item.Customization.Tags : [];
      for (const rawTag of tags) {
        const tag = normalizeTagText(rawTag);
        if (!tag || tagRegistry.has(tag)) continue;
        tagRegistry.set(tag, {
          Text: tag,
          Description: DEFAULT_TAG_DESCRIPTION,
          CreatedAt: now,
          UpdatedAt: now,
        });
      }
    }
  }

  function listTagDefinitions() {
    const usage = tagUsageCounts();
    return [...tagRegistry.values()]
      .map((tag) => ({ ...tag, UsageCount: usage.get(tag.Text) || 0 }))
      .sort((a, b) => a.Text.localeCompare(b.Text, "zh-CN"));
  }

  async function loadTagRegistry() {
    if (tagRegistry) return tagRegistry;
    await loadMetadata();
    tagRegistry = new Map();
    try {
      const res = await fetch("/tag_registry.jsonl");
      if (res.ok) {
        const text = await res.text();
        for (const line of text.split(/\r?\n/).filter(Boolean)) {
          const parsed = JSON.parse(line);
          const tagText = normalizeTagText(parsed?.Text);
          if (!tagText) continue;
          const createdAt = typeof parsed?.CreatedAt === "string" ? parsed.CreatedAt : new Date().toISOString();
          const updatedAt = typeof parsed?.UpdatedAt === "string" ? parsed.UpdatedAt : createdAt;
          tagRegistry.set(tagText, {
            Text: tagText,
            Description: normalizeTagText(parsed?.Description) || DEFAULT_TAG_DESCRIPTION,
            CreatedAt: createdAt,
            UpdatedAt: updatedAt,
          });
        }
      }
    } catch {
      // Browser preview keeps a memory-only registry when the file is absent.
    }
    seedTagRegistryFromMetadata();
    return tagRegistry;
  }

  function normalizeRegisteredTags(rawTags) {
    const tags = Array.isArray(rawTags) ? rawTags : [];
    const normalized = [...new Set(tags.map(normalizeTagText).filter(Boolean))];
    const unknown = normalized.filter((tag) => !tagRegistry.has(tag));
    return { tags: normalized, unknown };
  }

  function normalizeAlbumTitle(value) {
    return String(value ?? "").trim();
  }

  function albumUsageCounts() {
    const counts = new Map();
    for (const item of cache) {
      const album = normalizeAlbumTitle(item?.Customization?.Album);
      if (!album) continue;
      counts.set(album, (counts.get(album) || 0) + 1);
    }
    return counts;
  }

  function seedAlbumRegistryFromMetadata() {
    const now = new Date().toISOString();
    for (const item of cache) {
      const title = normalizeAlbumTitle(item?.Customization?.Album);
      if (!title || albumRegistry.has(title)) continue;
      albumRegistry.set(title, {
        Title: title,
        Description: DEFAULT_ALBUM_DESCRIPTION,
        CreatedAt: now,
        UpdatedAt: now,
      });
    }
  }

  function listAlbumDefinitions() {
    const usage = albumUsageCounts();
    return [...albumRegistry.values()]
      .map((album) => ({ ...album, UsageCount: usage.get(album.Title) || 0 }))
      .sort((a, b) => a.Title.localeCompare(b.Title, "zh-CN"));
  }

  async function loadAlbumRegistry() {
    if (albumRegistry) return albumRegistry;
    await loadMetadata();
    albumRegistry = new Map();
    try {
      const res = await fetch("/album_registry.jsonl");
      if (res.ok) {
        const text = await res.text();
        for (const line of text.split(/\r?\n/).filter(Boolean)) {
          const parsed = JSON.parse(line);
          const title = normalizeAlbumTitle(parsed?.Title);
          if (!title) continue;
          const createdAt = typeof parsed?.CreatedAt === "string" ? parsed.CreatedAt : new Date().toISOString();
          const updatedAt = typeof parsed?.UpdatedAt === "string" ? parsed.UpdatedAt : createdAt;
          albumRegistry.set(title, {
            Title: title,
            Description: normalizeAlbumTitle(parsed?.Description) || DEFAULT_ALBUM_DESCRIPTION,
            CreatedAt: createdAt,
            UpdatedAt: updatedAt,
          });
        }
      }
    } catch {
      // Browser preview keeps a memory-only registry when the file is absent.
    }
    seedAlbumRegistryFromMetadata();
    return albumRegistry;
  }

  function normalizeRegisteredAlbum(rawAlbum) {
    const album = normalizeAlbumTitle(rawAlbum);
    const unknown = album && !albumRegistry.has(album) ? [album] : [];
    return { album, unknown };
  }

  function normalizePersonName(value) {
    return String(value ?? "").trim();
  }

  function personUsageCounts() {
    const counts = new Map();
    for (const item of cache) {
      const people = Array.isArray(item?.Customization?.People) ? item.Customization.People : [];
      for (const rawPerson of people) {
        const person = normalizePersonName(rawPerson);
        if (!person) continue;
        counts.set(person, (counts.get(person) || 0) + 1);
      }
    }
    return counts;
  }

  function seedPersonRegistryFromMetadata() {
    const now = new Date().toISOString();
    for (const item of cache) {
      const people = Array.isArray(item?.Customization?.People) ? item.Customization.People : [];
      for (const rawPerson of people) {
        const name = normalizePersonName(rawPerson);
        if (!name || personRegistry.has(name)) continue;
        personRegistry.set(name, {
          Name: name,
          Description: "",
          CreatedAt: now,
          UpdatedAt: now,
        });
      }
    }
  }

  function listPersonDefinitions() {
    const usage = personUsageCounts();
    return [...personRegistry.values()]
      .map((person) => ({ ...person, UsageCount: usage.get(person.Name) || 0 }))
      .sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN"));
  }

  async function loadPersonRegistry() {
    if (personRegistry) return personRegistry;
    await loadMetadata();
    personRegistry = new Map();
    try {
      const res = await fetch("/person_registry.jsonl");
      if (res.ok) {
        const text = await res.text();
        for (const line of text.split(/\r?\n/).filter(Boolean)) {
          const parsed = JSON.parse(line);
          const name = normalizePersonName(parsed?.Name);
          if (!name) continue;
          const createdAt = typeof parsed?.CreatedAt === "string" ? parsed.CreatedAt : new Date().toISOString();
          const updatedAt = typeof parsed?.UpdatedAt === "string" ? parsed.UpdatedAt : createdAt;
          personRegistry.set(name, {
            Name: name,
            Description: normalizePersonName(parsed?.Description),
            CreatedAt: createdAt,
            UpdatedAt: updatedAt,
          });
        }
      }
    } catch {
      // Browser preview keeps a memory-only registry when the file is absent.
    }
    seedPersonRegistryFromMetadata();
    return personRegistry;
  }

  function normalizeRegisteredPeople(rawPeople) {
    const people = Array.isArray(rawPeople) ? rawPeople : [];
    const normalized = [...new Set(people.map(normalizePersonName).filter(Boolean))];
    const unknown = normalized.filter((person) => !personRegistry.has(person));
    return { people: normalized, unknown };
  }
  /**

   * Apply gallery filters, search conditions, and sorting to the cached list.

   * The behavior intentionally mirrors main-process query logic for UI parity.

   */

  function filterAndSort(list, options) {
    const { filters, search, sortBy, sortOrder } = options;
    let output = list.filter((item) => !item?.Customization?.Hidden);

    if (filters.album === UNASSIGNED_ALBUM_FILTER) {
      output = output.filter((item) => !normalizeAlbumTitle(item?.Customization?.Album));
    } else if (filters.album) {
      output = output.filter((item) => item?.Customization?.Album === filters.album);
    }
    if (filters.tag) output = output.filter((item) => (item?.Customization?.Tags || []).includes(filters.tag));
    if (filters.person) output = output.filter((item) => (item?.Customization?.People || []).includes(filters.person));

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
      await loadTagRegistry();
      await loadAlbumRegistry();
      await loadPersonRegistry();
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
          albums: [...albumRegistry.keys()].sort((a, b) => a.localeCompare(b, "zh-CN")),
          unassignedAlbumCount: all.filter((item) => !normalizeAlbumTitle(item?.Customization?.Album)).length,
          tags: [...tagRegistry.keys()].sort((a, b) => a.localeCompare(b, "zh-CN")),
          people: [...personRegistry.keys()].sort((a, b) => a.localeCompare(b, "zh-CN")),
        },
      };
    },
    async listTags() {
      await loadTagRegistry();
      return { ok: true, tags: listTagDefinitions() };
    },
    async createTag(payload) {
      await loadTagRegistry();
      const text = normalizeTagText(payload?.text ?? payload?.Text);
      const description = normalizeTagText(payload?.description ?? payload?.Description);
      if (!text || !description) return { ok: false, error: "Tag text and description are required" };
      if (tagRegistry.has(text)) return { ok: false, error: "Tag already exists" };
      const now = new Date().toISOString();
      const tag = { Text: text, Description: description, CreatedAt: now, UpdatedAt: now };
      tagRegistry.set(text, tag);
      return { ok: true, tag: { ...tag, UsageCount: 0 }, tags: listTagDefinitions() };
    },
    async updateTagDescription(payload) {
      await loadTagRegistry();
      const text = normalizeTagText(payload?.text ?? payload?.Text);
      const description = normalizeTagText(payload?.description ?? payload?.Description);
      const current = tagRegistry.get(text);
      if (!text || !description) return { ok: false, error: "Tag text and description are required" };
      if (!current) return { ok: false, error: "Tag not found" };
      const next = { ...current, Description: description, UpdatedAt: new Date().toISOString() };
      tagRegistry.set(text, next);
      return { ok: true, tag: { ...next, UsageCount: tagUsageCounts().get(text) || 0 }, tags: listTagDefinitions() };
    },
    async deleteTagGlobally(payload) {
      await loadTagRegistry();
      const text = normalizeTagText(payload?.text ?? payload?.Text);
      if (!text || !tagRegistry.has(text)) return { ok: false, error: "Tag not found" };
      tagRegistry.delete(text);
      let updatedCount = 0;
      for (const item of cache) {
        const tags = Array.isArray(item?.Customization?.Tags) ? item.Customization.Tags : [];
        if (!tags.includes(text)) continue;
        item.Customization = {
          ...(item.Customization || {}),
          Tags: tags.filter((tag) => tag !== text),
          MetadataUpdateDate: new Date().toISOString(),
        };
        updatedCount += 1;
      }
      return { ok: true, deleted: text, updatedCount, tags: listTagDefinitions() };
    },
    async listPeople() {
      await loadPersonRegistry();
      return { ok: true, people: listPersonDefinitions() };
    },
    async createPerson(payload) {
      await loadPersonRegistry();
      const name = normalizePersonName(payload?.name ?? payload?.Name);
      const description = normalizePersonName(payload?.description ?? payload?.Description);
      if (!name) return { ok: false, error: "Person name is required" };
      if (personRegistry.has(name)) return { ok: false, error: "Person already exists" };
      const now = new Date().toISOString();
      const person = { Name: name, Description: description, CreatedAt: now, UpdatedAt: now };
      personRegistry.set(name, person);
      return { ok: true, person: { ...person, UsageCount: 0 }, people: listPersonDefinitions() };
    },
    async updatePersonDescription(payload) {
      await loadPersonRegistry();
      const name = normalizePersonName(payload?.name ?? payload?.Name);
      const description = normalizePersonName(payload?.description ?? payload?.Description);
      const current = personRegistry.get(name);
      if (!name) return { ok: false, error: "Person name is required" };
      if (!current) return { ok: false, error: "Person not found" };
      const next = { ...current, Description: description, UpdatedAt: new Date().toISOString() };
      personRegistry.set(name, next);
      return { ok: true, person: { ...next, UsageCount: personUsageCounts().get(name) || 0 }, people: listPersonDefinitions() };
    },
    async deletePersonGlobally(payload) {
      await loadPersonRegistry();
      const name = normalizePersonName(payload?.name ?? payload?.Name);
      if (!name || !personRegistry.has(name)) return { ok: false, error: "Person not found" };
      personRegistry.delete(name);
      let updatedCount = 0;
      for (const item of cache) {
        const people = Array.isArray(item?.Customization?.People) ? item.Customization.People : [];
        if (!people.includes(name)) continue;
        item.Customization = {
          ...(item.Customization || {}),
          People: people.filter((person) => person !== name),
          MetadataUpdateDate: new Date().toISOString(),
        };
        updatedCount += 1;
      }
      return { ok: true, deleted: name, updatedCount, people: listPersonDefinitions() };
    },
    async listAlbums() {
      await loadAlbumRegistry();
      await loadPersonRegistry();
      return { ok: true, albums: listAlbumDefinitions() };
    },
    async createAlbum(payload) {
      await loadAlbumRegistry();
      await loadPersonRegistry();
      const title = normalizeAlbumTitle(payload?.title ?? payload?.Title);
      const description = normalizeAlbumTitle(payload?.description ?? payload?.Description);
      if (!title || !description) return { ok: false, error: "Album title and description are required" };
      if (albumRegistry.has(title)) return { ok: false, error: "Album already exists" };
      const now = new Date().toISOString();
      const album = { Title: title, Description: description, CreatedAt: now, UpdatedAt: now };
      albumRegistry.set(title, album);
      return { ok: true, album: { ...album, UsageCount: 0 }, albums: listAlbumDefinitions() };
    },
    async updateAlbumDescription(payload) {
      await loadAlbumRegistry();
      await loadPersonRegistry();
      const title = normalizeAlbumTitle(payload?.title ?? payload?.Title);
      const description = normalizeAlbumTitle(payload?.description ?? payload?.Description);
      const current = albumRegistry.get(title);
      if (!title || !description) return { ok: false, error: "Album title and description are required" };
      if (!current) return { ok: false, error: "Album not found" };
      const next = { ...current, Description: description, UpdatedAt: new Date().toISOString() };
      albumRegistry.set(title, next);
      return { ok: true, album: { ...next, UsageCount: albumUsageCounts().get(title) || 0 }, albums: listAlbumDefinitions() };
    },
    async deleteAlbumGlobally(payload) {
      await loadAlbumRegistry();
      await loadPersonRegistry();
      const title = normalizeAlbumTitle(payload?.title ?? payload?.Title);
      if (!title || !albumRegistry.has(title)) return { ok: false, error: "Album not found" };
      albumRegistry.delete(title);
      let updatedCount = 0;
      for (const item of cache) {
        if (normalizeAlbumTitle(item?.Customization?.Album) !== title) continue;
        item.Customization = {
          ...(item.Customization || {}),
          Album: "",
          MetadataUpdateDate: new Date().toISOString(),
        };
        updatedCount += 1;
      }
      return { ok: true, deleted: title, updatedCount, albums: listAlbumDefinitions() };
    },
    async updateCustomization(payload) {
      // Browser mode updates in memory only; it does not write back to disk.
      const all = await loadMetadata();
      await loadTagRegistry();
      await loadAlbumRegistry();
      await loadPersonRegistry();
      const idx = all.findIndex((x) => x.FilePath === payload.filePath);
      if (idx < 0) return { ok: false, error: "Item not found" };
      if (Object.prototype.hasOwnProperty.call(payload?.customization || {}, "Tags")) {
        const validation = normalizeRegisteredTags(payload.customization.Tags);
        if (validation.unknown.length) return { ok: false, error: `Unknown tag: ${validation.unknown.join(", ")}` };
        payload.customization.Tags = validation.tags;
      }
      if (Object.prototype.hasOwnProperty.call(payload?.customization || {}, "Album")) {
        const validation = normalizeRegisteredAlbum(payload.customization.Album);
        if (validation.unknown.length) return { ok: false, error: `Unknown album: ${validation.unknown.join(", ")}` };
        payload.customization.Album = validation.album;
      }
      if (Object.prototype.hasOwnProperty.call(payload?.customization || {}, "People")) {
        const validation = normalizeRegisteredPeople(payload.customization.People);
        if (validation.unknown.length) return { ok: false, error: `Unknown person: ${validation.unknown.join(", ")}` };
        payload.customization.People = validation.people;
      }
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
      await loadTagRegistry();
      await loadAlbumRegistry();
      await loadPersonRegistry();
      const filePaths = Array.isArray(payload?.filePaths) ? payload.filePaths : [];
      const addTags = [...new Set((payload?.addTags || []).map((x) => String(x || "").trim()).filter(Boolean))];
      const addPeople = [...new Set((payload?.addPeople || []).map((x) => String(x || "").trim()).filter(Boolean))];
      const validation = normalizeRegisteredTags(addTags);
      if (validation.unknown.length) return { ok: false, error: `Unknown tag: ${validation.unknown.join(", ")}` };
      const peopleValidation = normalizeRegisteredPeople(addPeople);
      if (peopleValidation.unknown.length) return { ok: false, error: `Unknown person: ${peopleValidation.unknown.join(", ")}` };
      const locationPatch = payload?.locationPatch && typeof payload.locationPatch === "object" ? payload.locationPatch : {};
      const customizationPatch = payload?.customizationPatch && typeof payload.customizationPatch === "object" ? payload.customizationPatch : {};
      if (Object.prototype.hasOwnProperty.call(customizationPatch, "Album")) {
        const albumValidation = normalizeRegisteredAlbum(customizationPatch.Album);
        if (albumValidation.unknown.length) return { ok: false, error: `Unknown album: ${albumValidation.unknown.join(", ")}` };
        customizationPatch.Album = albumValidation.album;
      }
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
        for (const tag of validation.tags) {
          if (!mergedTags.includes(tag)) mergedTags.push(tag);
        }

        const currentPeople = Array.isArray(all[idx]?.Customization?.People) ? all[idx].Customization.People : [];
        const mergedPeople = [...currentPeople];
        for (const person of peopleValidation.people) {
          if (!mergedPeople.includes(person)) mergedPeople.push(person);
        }

        all[idx].Customization = {
          ...all[idx].Customization,
          ...customizationPatch,
          Tags: mergedTags,
          People: mergedPeople,
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
