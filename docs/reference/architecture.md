# Runtime Architecture

Platform, Windows packaging, IPC contracts, source ownership and dependency boundaries.

Part of the [project specification](../../PROJECT.md). See the [documentation index](../README.md) for related references. Source paths in prose are relative to the repository root.

## Platform, Technology, and Boundaries

- Target: Windows 10/11 x64.
- Desktop container: Electron 44.
- Renderer: Vue 3 SFC and Vite.
- Image parsing and thumbnails: Sharp and exifr.
- Local semantic embeddings: pinned Transformers.js 3.7.2 with CPU ONNX Runtime, quantized CLIP and multilingual MiniLM. Sharp is resolved to the application version to avoid loading conflicting native libraries. Native ONNX dependencies are unpacked alongside Sharp. Models are downloaded/imported separately.
- Video probing and frame extraction: bundled Windows x64 FFmpeg/FFprobe 8.1.2.
- Capture-location time zones: offline `geo-tz` coordinate boundaries plus Electron/Node `Intl` IANA time-zone rules; no runtime network request is made.
- Configuration: YAML.
- Persistence: JSONL for media/registries and JSON for chat sessions; export: UTF-8 BOM CSV.
- The main process and renderer communicate through an explicit IPC allowlist. The renderer cannot access Node or the filesystem directly.

### Process and Window Model

PhotoManager keeps Electron's single-instance lock so Chromium profile data, renderer `localStorage`, global configuration, provider settings, and machine-local state have one process owner. A later operating-system launch does not focus or reuse an existing window: the `second-instance` event creates another library-entry window. There is deliberately no in-application New Window command.

`window-session-router.js` maps trusted main-frame `webContents` senders to isolated sessions and preserves that ownership across asynchronous IPC work. Each session contains one `BrowserWindow`, one mutable application runtime, one chat service, one service set, and at most one active library. IPC payloads never choose a session or window identifier. Global normalized configuration, media-tool availability, the provider file, and the last successfully opened library path remain coordinator-owned.

Launching more windows therefore does not create more Electron or Chromium profile owners. Different window sessions may hold different library locks concurrently. The coordinator additionally reserves `LibraryId` values so copied roots representing the same logical library cannot open in two windows even though their path-local lock files differ.

Supported media extensions:

- Images: `.jpg`, `.jpeg`, `.png`, `.bmp`, `.webp`, `.gif`.
- Videos: `.mp4`, `.mov`, `.mkv`, `.avi`.

An extension only determines scan eligibility. A record may still exist when its contents are damaged or its codec is unsupported; `Picture.ProbeStatus` or `Video.ProbeStatus` represents the technical parsing state.

### Windows Packaging

`electron-builder.yml` defines only the Windows x64 directory target. The personal desktop release is the complete `release/win-unpacked/` folder, launched through `PhotoManager.exe`; no installer, shortcut registration, or uninstall entry is generated. The package contains the main process, preload, shared schemas, internal maintenance scripts, the built renderer, and production dependencies inside `app.asar`. Sharp's native packages are unpacked. FFmpeg and FFprobe are copied as executable program resources to `resources/tools/ffmpeg/bin`; they are never stored in ASAR or copied to AppData.

The packaged runtime distinguishes the code root from the program-resource root. The code root contains `app.asar` and is used to load the renderer, preload, and maintenance worker. The program-resource root is the repository root in development and `process.resourcesPath` when packaged. `PHOTO_MANAGER_RESOURCE_ROOT` passes that real directory to maintenance child processes, which also use it as their working directory. Standalone scripts fall back to the repository root when the variable is absent. This prevents executable lookup and child-process working directories from resolving inside the read-only ASAR virtual filesystem.

`npm run pack:win` builds the renderer and creates an unpacked application under `release/win-unpacked/`. `npm run dist:win` runs all tests and then invokes `pack:win` to produce that same unpacked folder. Release builds require the Git LFS FFmpeg files to be materialized. The folder includes all runtime dependencies and must remain intact when moved. User settings stay in AppData and library data stay in the selected libraries; the executable directory is not a portable user-data store.

## IPC Contract

Assistant adds the `chat:*` request allowlist and `chat:event` updates through `photoManagerApi.chat`. Its main-process services, renderer composable, provider boundary and cancellation lifecycle are documented in [Viewer Chat Implementation](../agent/implementation.md).

Web search adds `chat:searchConfiguration`, `chat:saveSearchConfiguration`, `chat:testSearch`, and `chat:openSource`. The last accepts only `sessionId/sourceId`; the owning main service resolves and validates the stored URL for the system browser. Send includes an explicit Boolean `webEnabled`, while stored attempts record availability through their tool contracts. All commands retain sender/frame isolation.

Request groups: `app:get-config`; `library:*` lifecycle, cancellation, directories, and info; `maintenance:start/show-output`; `gallery:query`; `photo:update-customization/batch-update/delete-media`; list/create/update/delete-global for four registries; single and batch clipboard/system media actions including `photo:copy-file/copy-files`; `photo:report-playback`; and `window:action/get-state`. Events are `library:state-changed`, `library:progress`, `maintenance:progress`, and `window:state-changed`.

Media IPC targets `mediaId`/`mediaIds`. Persisted IDs are PascalCase, mutation payloads camelCase, and each channel rejects unknown fields and obsolete PascalCase aliases. `FilePath` is never an action target: the main process resolves `MediaId` through its current index and verifies the resulting path remains inside the active library before any filesystem operation.

IPC registration requires sender-session routing and a mutation coordinator. The registrar explicitly lists channels that enter the owning session's mutation queue; reads and cancellation remain independent. Gallery responses contain `total`, `groups`, and a window-scoped retrieval snapshot. The `retrieval:snapshot/send/stop/control/setLimit` allowlist and `retrieval:event` support the in-memory [gallery retrieval assistant](retrieval.md); viewer chat persistence is unchanged. The unused private `acceptChanges` chat-send flag is removed; exact-source rejection and explicit input exclusion remain unchanged.

## Source Responsibilities

### `scripts/`

- `application-paths.js`: roaming/local paths and pre-ready Electron storage setup.
- `program-paths.js`: development/packaged program-resource root resolution and worker propagation contract.
- `application-config.js`: complete defaults and shared strict configuration loading.
- `library-core.js`, `library-access.js`, `library-lock.js`, `library-backup.js`, `library-transaction.js`, `media-deletion-transaction.js`: boundaries, authorization, locking, snapshots, atomic writes, registry transactions, media-file staging, and recovery.
- `operation-progress.js`, `maintenance-worker.js`: structured operation reporting and child-process dispatch.
- `common.js`, `library-data.js`: scanning, hashing, record creation, registry loading, and reference validation.
- `media-tools.js`, `media-time.js`, `thumbnail-cache.js`: FFmpeg execution/normalization, reference-time-zone logic, and thumbnail queues.
- `video-first-frame.js`: shared first-frame stream selection, orientation/aspect normalization, and cancellable FFmpeg execution for thumbnails and covers. `video-cover-cache.js` and main-process `video-cover-service.js` own the separate derived cover cache and window-scoped cancellation.
- `viewer-image-resources.js` owns capability-scoped viewer image URLs and streams trusted photo/cover files to Chromium. `ViewerImage.vue` and `use-viewer-image.js` own shared image display, bounded adjacent preloads and selected-cover repair; playback owns the decoded-frame handoff. See the media-pipeline reference for lifecycle and cache contracts.
- `init-metadata.js`, `update-metadata.js`, `verify-metadata.js`, `build-thumbnails.js`, `export-metadata-csv.js`: maintenance operations.
- `start-electron.js`: sanitize the inherited environment and launch Electron.

### `src/main/`

`main.js` is the composition root and application coordinator. `application-window-lifecycle.js` converts later operating-system launches into windows; `window-session-router.js` owns sender-to-session routing; `library-claim-registry.js` prevents duplicate logical-library ownership inside the coordinator; `application-runtime.js` creates isolated per-window runtime state; `application-state.js` handles shared local state through the common atomic writer. Simple registry catalog/service modules share tag/person/album logic; location domain/catalog/service modules own hierarchy-specific behavior. `gallery-query.js` is pure filtering/grouping; `gallery-item-enricher.js` adds renderer paths and cached thumbnail status. `metadata-edit-service.js` owns validated edits and rollback. `ipc-handlers.js` registers the allowlist without owning session state; `window-manager.js` owns BrowserWindow lifecycle and awaits safe session closure; `preload.js` is the only renderer bridge.

Shared schema modules enforce exact keys, UUID v4 identity, customization patches, global uniqueness, references, location contexts, and parent chains. Dependency direction is `main.js` assembly → IPC → domain services through explicit runtime accessors → `scripts/library-*` persistence. Domain modules never import the IPC registrar or window.

The semantic subsystem lives in `src/main/semantic/`: projections, pinned model assets, CPU embedding workers, immutable index storage, manual building and vector ranking. `src/main/retrieval/service.js` owns the window-local planner and active query. `scripts/build-semantic-index.js` is the shared CLI/maintenance entry point. Electron inference runs in a utility process; CLI inference and ranking use workers. See [Semantic retrieval](retrieval.md) for persisted contracts and resource limits.

### `src/renderer/`

The renderer is a declarative `App.vue` shell, application composition root, state-owning composables, pure domain functions, and presentation components. Components consume narrow contexts and never reverse-import the composition root. Pure functions import no Vue/DOM/Electron; composables import no page components and collaborate only through callbacks/refs wired at the root.

Each renderer owns state for its window: library session; gallery query and stale-request suppression; full-result selection; shared media-deletion confirmation; viewer navigation/shortcuts; editor drafts/locks; media transform listeners/observer; video element lifecycle/preferences; one composable per registry; library-scoped recent history; window controls; and UI feedback. Every owner of a global listener, timer, observer, element, or IPC subscription exposes idempotent cleanup called on unmount.

Contexts are split into library, gallery, gallery-filter, viewer, settings, four registries, and UI feedback. Components render and forward intent. Shared picker/menu components retain their single-value, multi-value, filter, and hierarchy semantics.

Global CSS remains deliberate. `styles.css` alone imports tokens, library, base, gallery, viewer fields, registry controls, customization, viewer media, registry overlays, feedback, then responsive overrides. Keep tokens centralized, place rules with the DOM owner, preserve import order, and add a module only for a stable new visual responsibility.

For extensions: put deterministic algorithms in pure modules with `node:test`; give each state one lifecycle owner; coordinate cross-domain effects at the composition root; expose actions through the narrow existing context; use preload IPC only; use `shallowRef` for normalized full-result collections and separate edit drafts; verify listener cleanup during behavior-preserving refactors.

The application icon uses the blue stacked-photo artwork in `build/icon.svg`, shared with the agent-probe prototype. `build/icon.ico` contains Windows sizes from 16px through 256px and is used for executable resources and the BrowserWindow icon. Packaging must preserve executable resource editing so the icon is embedded; disable signing separately for unsigned local builds.

Chat tools separate context preparation, provider normalization, sequential run orchestration, tool registration/execution, proposal review and persistence. `chat:decide` accepts only a session/proposal identity and decision; there is no renderer-callable generic tool executor. Per-window `mutation-coordinator.js` orders library/registry/metadata mutations and chat acceptance. Acceptance acquires this queue before the chat queue, revalidates the proposal and commits metadata plus review state together. Read-only IPC remains independent. See [agent module ownership](../agent/implementation.md).
