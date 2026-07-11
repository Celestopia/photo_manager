# PhotoManager

PhotoManager is a local-first desktop photo manager built with Electron + Vue.
It is designed for personal usage on Windows and stores everything as local files
(`config.yml`, the configured `dataDir`, image files, thumbnail cache, logs).
Photo metadata and all registry definitions use fixed JSONL filenames under `dataDir`. Tags, albums, people, and primary locations are therefore managed as reusable registered data while each photo stores their selected names.

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

3. Optional thumbnail cache warmup only:

```bash
npm run build-thumbnails
```

## Macro Architecture

The project has three runtime layers:

1. Electron main process (`src/main/main.js`)
- Loads and merges `config.yml` with defaults.
- Resolves the configurable `dataDir` and loads its five fixed JSONL files.
- Loads photo metadata and tag/album/person/location registries into in-memory maps.
- Exposes IPC APIs for query/update/tag registry/album registry/person registry/location registry/copy/window control.
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

## Metadata and Data Flow

### Files

- `config.yml`: runtime configuration.
- `dataDir`: configurable data directory; relative paths resolve from the project root and absolute paths are used directly.
- `photo_workspace/`: image root folder.
- `thumb_cache/`: hash-addressed thumbnail cache (`<SHA256Hash>.webp`).
- `data/photo_metadata.jsonl`: one JSON object per line.
- `data/tag_registry.jsonl`: one tag definition per line (`Text`, `Description`, `CreatedAt`, `UpdatedAt`).
- `data/album_registry.jsonl`: one album definition per line (`Title`, `Description`, `CreatedAt`, `UpdatedAt`).
- `data/person_registry.jsonl`: one person definition per line (`Name`, optional `Description`, `CreatedAt`, `UpdatedAt`).
- `data/location_registry.jsonl`: one location definition per line (`Name`, optional `Country`/`Province`/`City`/`Parent`/`Description`, `CreatedAt`, `UpdatedAt`).
- `logs/YYYY-MM-DD.log`: runtime diagnostics.

### Startup flow (Electron mode)

1. Main process loads config.
2. Main process loads metadata JSONL into in-memory index.
3. Main process loads tag registry JSONL and backfills definitions for legacy tags already used by metadata.
4. Main process loads album registry JSONL and backfills definitions for legacy non-empty albums.
5. Main process loads person registry JSONL and backfills definitions for legacy people.
6. Main process loads location registry JSONL, migrates legacy `Location.Site` into `Location.Place`, and backfills missing location definitions.
7. Main process starts thumbnail warmup for missing cache entries.
8. Renderer asks config plus tag/album/person/location registries via IPC.
9. Renderer requests first gallery page (`gallery:query`).
10. Main process filters/sorts/paginates and returns serializable payload with thumbnail paths.
11. Renderer renders grouped gallery (thumbnail first, original image fallback on error).

### Edit flow (Customization update)

1. User edits fields in viewer panel.
2. User sets album by selecting from the registered album list or creating an album with a required description.
3. User adds tags by selecting from the registered tag list or creating a tag with an optional description.
4. User adds people by selecting from the registered person list or creating a person; description may be empty.
5. User sets primary location from the registered location tree, optionally adding free-text location detail.
6. Renderer sends `photo:update-customization`.
7. Main process rejects unregistered albums/tags/people/locations, updates metadata Map record, and stamps `MetadataUpdateDate`.
8. Main process atomically rewrites JSONL (`.tmp` -> rename).
9. Updated item is returned and renderer cache is patched in place.

### Tag registry flow

1. Renderer loads tag definitions via `tag:list`.
2. `tag:create` requires non-empty tag text; description is optional, then it rewrites `dataDir/tag_registry.jsonl`.
3. `tag:update-description` updates or clears a tag description without changing photo metadata.
4. `tag:delete-global` removes a tag from the registry and from every photo record that uses it.

### Album registry flow

1. Renderer loads album definitions via `album:list`.
2. `album:create` requires non-empty album title and description, then rewrites `dataDir/album_registry.jsonl`.
3. `album:update-description` updates an album description without changing photo metadata.
4. `album:delete-global` removes an album from the registry and clears that album field on every photo that uses it.

### Person registry flow

1. Renderer loads person definitions via `person:list`.
2. `person:create` requires a non-empty person name; description may be empty.
3. `person:update-description` updates optional person notes without changing photo metadata.
4. `person:delete-global` removes a person from the registry and from every photo record that uses it.

### Location registry flow

1. Renderer loads location definitions via `location:list`.
2. `location:create` requires a unique non-empty `Name`; country, province, city, parent, and description are optional.
3. `location:update` can edit country/province/city/parent/description but cannot rename the location.
4. `location:delete-global` removes the location, clears exact photo references, and makes its direct children parentless.
5. Gallery location filtering includes the selected location and all descendants; `Location.Detail` is not searchable.

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

### Changing the data directory

1. Close PhotoManager.
2. Move all five fixed JSONL files to the new directory.
3. Update `dataDir` in `config.yml` using a project-relative or absolute path.
4. Restart the app and run `npm run verify-metadata`.

`npm run export-metadata-csv` writes `photo_metadata.csv` to `dataDir` by default. An explicit output path still overrides this default.

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
    App.vue          # Main SFC component
    app.js           # Vue mount entry
    components/
      GalleryView.vue # Gallery mode component
      ViewerView.vue  # Viewer mode component
    styles.css       # UI style
vite.config.mjs      # Vite config for renderer build
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
