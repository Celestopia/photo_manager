# Runtime Architecture

Status: implemented application behavior. Part of the [project specification](../../PROJECT.md); browse the [documentation index](../README.md). Source paths in this reference are relative to the repository root.

Platform and packaging, Electron/preload contracts, source ownership and dependency direction.

## Platform, Technology, and Boundaries

- Target: Windows 10/11 x64.
- Desktop container: Electron 44.
- Renderer: Vue 3 SFC and Vite.
- Image parsing and thumbnails: Sharp and exifr.
- Video probing and frame extraction: bundled Windows x64 FFmpeg/FFprobe 8.1.2.
- Capture-location time zones: offline `geo-tz` coordinate boundaries plus Electron/Node `Intl` IANA time-zone rules; no runtime network request is made.
- Configuration: YAML.
- Persistence: JSONL; export: UTF-8 BOM CSV.
- The main process and renderer communicate through an explicit IPC allowlist. The renderer cannot access Node or the filesystem directly.

Supported media extensions:

- Images: `.jpg`, `.jpeg`, `.png`, `.bmp`, `.webp`, `.gif`.
- Videos: `.mp4`, `.mov`, `.mkv`, `.avi`.

An extension only determines scan eligibility. A record may still exist when its contents are damaged or its codec is unsupported; `Picture.ProbeStatus` or `Video.ProbeStatus` represents the technical parsing state.

### Windows Packaging

`electron-builder.yml` defines an x64 NSIS assisted installer and an unpacked smoke-test target. The package contains the main process, preload, shared schemas, internal maintenance scripts, the built renderer, and production dependencies inside `app.asar`. Sharp's native packages are unpacked. FFmpeg and FFprobe are copied as executable program resources to `resources/tools/ffmpeg/bin`; they are never stored in ASAR or copied to AppData.

The installed runtime distinguishes the code root from the program-resource root. The code root contains `app.asar` and is used to load the renderer, preload, and maintenance worker. The program-resource root is the repository root in development and `process.resourcesPath` when packaged. `PHOTO_MANAGER_RESOURCE_ROOT` passes that real directory to maintenance child processes, which also use it as their working directory. Standalone scripts fall back to the repository root when the variable is absent. This prevents executable lookup and child-process working directories from resolving inside the read-only ASAR virtual filesystem.

`npm run pack:win` builds the renderer and creates an unpacked application under `release/win-unpacked/`. `npm run dist:win` first runs all tests, builds the renderer, and creates `release/PhotoManager-<version>-x64-Setup.exe`. Release builds require the Git LFS FFmpeg files to be materialized. Code signing is optional for local builds but required by release policy before public distribution; credentials must come from the environment and must never be committed.

## IPC Contract

Request groups: `app:get-config`; `library:*` lifecycle, cancellation, directories, and info; `maintenance:start/show-output`; `gallery:query`; `photo:update-customization/batch-update`; list/create/update/delete-global for four registries; clipboard/system media actions; `photo:report-playback`; and `window:action/get-state`. Events are `library:state-changed`, `library:progress`, `maintenance:progress`, and `window:state-changed`.

Media IPC targets `mediaId`/`mediaIds`. Persisted IDs are PascalCase, mutation payloads camelCase, and each channel rejects unknown fields and obsolete PascalCase aliases. `FilePath` is never an action target: the main process resolves `MediaId` through its current index and verifies the resulting path remains inside the active library before any filesystem operation.

## Source Responsibilities

### `scripts/`

- `application-paths.js`: roaming/local paths and pre-ready Electron storage setup.
- `program-paths.js`: development/packaged program-resource root resolution and worker propagation contract.
- `application-config.js`: complete defaults and shared strict configuration loading.
- `library-core.js`, `library-access.js`, `library-lock.js`, `library-backup.js`, `library-transaction.js`: boundaries, authorization, locking, snapshots, atomic writes, transactions, and recovery.
- `operation-progress.js`, `maintenance-worker.js`: structured operation reporting and child-process dispatch.
- `common.js`, `library-data.js`: scanning, hashing, record creation, registry loading, and reference validation.
- `media-tools.js`, `media-time.js`, `thumbnail-cache.js`: FFmpeg execution/normalization, reference-time-zone logic, and thumbnail queues.
- `init-metadata.js`, `update-metadata.js`, `verify-metadata.js`, `build-thumbnails.js`, `export-metadata-csv.js`: maintenance operations.
- `start-electron.js`: sanitize the inherited environment and launch Electron.

### `src/main/`

`main.js` is the composition root. `application-runtime.js` creates isolated runtime state; `application-state.js` handles atomic local state. Simple registry catalog/service modules share tag/person/album logic; location domain/catalog/service modules own hierarchy-specific behavior. `gallery-query.js` is pure filtering/counting/grouping; `gallery-item-enricher.js` adds renderer paths and cached thumbnail status. `metadata-edit-service.js` owns validated edits and rollback. `ipc-handlers.js` registers the allowlist without owning state; `window-manager.js` owns BrowserWindow lifecycle; `preload.js` is the only renderer bridge.

Shared schema modules enforce exact keys, UUID v4 identity, customization patches, global uniqueness, references, location contexts, and parent chains. Dependency direction is `main.js` assembly → IPC → domain services through explicit runtime accessors → `scripts/library-*` persistence. Domain modules never import the IPC registrar or window.

### `src/renderer/`

The renderer is a declarative `App.vue` shell, application composition root, state-owning composables, pure domain functions, and presentation components. Components consume narrow contexts and never reverse-import the composition root. Pure functions import no Vue/DOM/Electron; composables import no page components and collaborate only through callbacks/refs wired at the root.

State owners are: library session; gallery query and stale-request suppression; full-result selection; viewer navigation/shortcuts; editor drafts/locks; media transform listeners/observer; video element lifecycle/preferences; one composable per registry; library-scoped recent history; window controls; and UI feedback. Every owner of a global listener, timer, observer, element, or IPC subscription exposes idempotent cleanup called on unmount.

Contexts are split into library, gallery, gallery-filter, viewer, settings, four registries, and UI feedback. Components render and forward intent. Shared picker/menu components retain their single-value, multi-value, filter, and hierarchy semantics.

Global CSS remains deliberate. `styles.css` alone imports tokens, library, base, gallery, viewer fields, registry controls, customization, viewer media, registry overlays, feedback, then responsive overrides. Keep tokens centralized, place rules with the DOM owner, preserve import order, and add a module only for a stable new visual responsibility.

For extensions: put deterministic algorithms in pure modules with `node:test`; give each state one lifecycle owner; coordinate cross-domain effects at the composition root; expose actions through the narrow existing context; use preload IPC only; use `shallowRef` for normalized full-result collections and separate edit drafts; verify listener cleanup during behavior-preserving refactors.
