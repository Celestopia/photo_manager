# PhotoManager

PhotoManager is a local-first desktop photo manager built with Electron + Vue.
It is designed for personal usage on Windows and stores everything as local files
(`config.yml`, `photo_metadata.jsonl`, image files, thumbnail cache, logs).
Tag definitions are stored separately in `tag_registry.jsonl` so each tag has a
clear description and can be reused consistently.

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Start Electron app:

```bash
npm start
```

If your shell previously set `ELECTRON_RUN_AS_NODE=1`, clear it first:

```powershell
$env:ELECTRON_RUN_AS_NODE=$null
npm start
```

3. Optional browser preview mode:

```bash
npm run start:web
```

Then open `http://localhost:5173/`.

4. Optional renderer dev server (for SFC hot reload):

```bash
npm run dev:renderer
```

5. Optional thumbnail cache warmup only:

```bash
npm run build-thumbnails
```

## Macro Architecture

The project has three runtime layers:

1. Electron main process (`src/main/main.js`)
- Loads and merges `config.yml` with defaults.
- Loads `photo_metadata.jsonl` into memory (`Map<FilePath, Metadata>`).
- Loads `tag_registry.jsonl` into memory (`Map<Text, TagDefinition>`).
- Exposes IPC APIs for query/update/tag registry/copy/window control.
- Creates and monitors BrowserWindow.

2. Preload bridge (`src/main/preload.js`)
- Exposes a minimal `window.photoManagerApi`.
- Prevents renderer from direct Node access.
- Serializes payloads to avoid structured-clone errors.

3. Renderer UI (`src/renderer/App.vue` + `src/renderer/app.js`)
- Vue Single File Component (SFC) powered by Vite build pipeline.
- Gallery mode: filter/search/sort/paginate/group by date, thumbnail-first loading.
- Viewer mode: zoom/pan/mirror/fullscreen/navigation/edit metadata.
- Calls `photoManagerApi` for data and persistence operations.

## Browser Preview Architecture

Browser preview exists for debugging UI without Electron:

- `scripts/start-web-preview.js`: static server for built renderer and local metadata/workspace files.
- `dist/renderer/browser.html`: renderer entry for browser mode (built from `src/renderer/browser.html`).
- `src/renderer/public/browser-api.js`: mock implementation of `photoManagerApi`.

Important difference:
- Browser mode metadata edits are in-memory only (no write-back to JSONL).
- Browser mode tag registry edits are also in-memory only.
- Electron mode writes updates back to `photo_metadata.jsonl` and `tag_registry.jsonl`.

## Metadata and Data Flow

### Files

- `config.yml`: runtime configuration.
- `photo_workspace/`: image root folder.
- `thumb_cache/`: hash-addressed thumbnail cache (`<SHA256Hash>.webp`).
- `photo_metadata.jsonl`: one JSON object per line.
- `tag_registry.jsonl`: one tag definition per line (`Text`, `Description`, `CreatedAt`, `UpdatedAt`).
- `logs/YYYY-MM-DD.log`: runtime diagnostics.

### Startup flow (Electron mode)

1. Main process loads config.
2. Main process loads metadata JSONL into in-memory index.
3. Main process loads tag registry JSONL and backfills definitions for legacy tags already used by metadata.
4. Main process starts thumbnail warmup for missing cache entries.
5. Renderer asks config and tag registry via IPC.
6. Renderer requests first gallery page (`gallery:query`).
7. Main process filters/sorts/paginates and returns serializable payload with thumbnail paths.
8. Renderer renders grouped gallery (thumbnail first, original image fallback on error).

### Edit flow (Customization update)

1. User edits fields in viewer panel.
2. User adds tags by selecting from the registered tag list or creating a tag with a required description.
3. Renderer sends `photo:update-customization`.
4. Main process rejects unregistered tags, updates metadata Map record, and stamps `MetadataUpdateDate`.
5. Main process atomically rewrites JSONL (`.tmp` -> rename).
6. Updated item is returned and renderer cache is patched in place.

### Tag registry flow

1. Renderer loads tag definitions via `tag:list`.
2. `tag:create` requires non-empty tag text and description, then rewrites `tag_registry.jsonl`.
3. `tag:update-description` updates a tag description without changing photo metadata.
4. `tag:delete-global` removes a tag from the registry and from every photo record that uses it.

## Metadata Maintenance Scripts

Run these from project root:

```bash
npm run init-metadata
npm run update-metadata
npm run verify-metadata
npm run build-thumbnails
```

### `init-metadata`
- Full scan of workspace.
- Builds metadata from file stats + EXIF + SHA256.
- Rewrites JSONL from scratch (image records in v1 UI).

### `update-metadata`
- Incremental rescan.
- Preserves `Customization` from existing metadata.
- Uses SHA256 to track moved/renamed files.
- Rewrites JSONL snapshot.

### `verify-metadata`
- Recomputes hashes from disk.
- Compares with JSONL.
- Reports missing or tampered records.

### `build-thumbnails`
- Loads existing metadata records.
- Generates missing thumbnails into `thumb_cache/` using `<SHA256Hash>.webp`.
- Applies long-image crop strategy (top for very tall images, left for very wide images).

## Key Design Decisions

1. Local-first and offline
- No database, no network dependency for core features.

2. JSONL + in-memory Map
- Fast random access by `FilePath`.
- Easy to inspect and recover manually.

3. Atomic file write for metadata
- Prevents partial-write corruption on crashes.

4. Explicit IPC surface
- Narrow bridge (`photoManagerApi`) keeps renderer/main responsibilities clear.

## Project Structure

```text
src/
  main/
    main.js          # Electron main process + IPC + window lifecycle
    preload.js       # Secure renderer bridge
  renderer/
    index.html       # Electron renderer entry
    browser.html     # Browser preview entry
    App.vue          # Main SFC component
    app.js           # Vue mount entry
    components/
      GalleryView.vue # Gallery mode component
      ViewerView.vue  # Viewer mode component
    public/
      browser-api.js # Browser-mode API shim
    styles.css       # UI style
vite.config.mjs      # Vite config for multi-page renderer build
scripts/
  common.js          # Shared metadata utilities
  thumbnail-cache.js # Shared thumbnail generation/cache utilities
  build-thumbnails.js # Thumbnail cache warmup script
  init-metadata.js   # Full rebuild script
  update-metadata.js # Incremental sync script
  verify-metadata.js # Integrity check script
```

## Notes

- Before first run, verify `config.yml` paths match your local folders.
- Current implementation focuses on image management; video schema hooks are reserved.
- Runtime errors are surfaced inside HTML pages to avoid silent blank screens.
