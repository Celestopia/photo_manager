# Runtime Architecture

Platform, Windows packaging, IPC contracts, source ownership and dependency boundaries.

Part of the [project specification](../../PROJECT.md). See the [documentation index](../README.md) for related references. Source paths in prose are relative to the repository root.

## Platform, Technology, and Boundaries

- Target: Windows 10/11 x64.
- Desktop container: Electron 44.
- Renderer: Vue 3 SFC and Vite.
- Image parsing and thumbnails: Sharp and exifr.
- Video probing and frame extraction: bundled Windows x64 FFmpeg/FFprobe 8.1.2.
- Capture-location time zones: offline `geo-tz` coordinate boundaries plus Electron/Node `Intl` IANA time-zone rules; no runtime network request is made.
- Configuration: YAML.
- Persistence: JSONL for media/registries and JSON for chat sessions; export: UTF-8 BOM CSV.
- The main process and renderer communicate through an explicit IPC allowlist. The renderer cannot access Node or the filesystem directly.

### Process and Window Model

Photo Manager keeps Electron's single-instance lock so Chromium profile data, renderer `localStorage`, global configuration, provider settings, and machine-local state have one process owner. A later operating-system launch does not focus or reuse an existing window: the `second-instance` event creates another library-entry window. There is deliberately no in-application New Window command.

`window-session-router.js` maps trusted main-frame `webContents` senders to isolated sessions and preserves that ownership across asynchronous IPC work. Each session contains one `BrowserWindow`, one mutable application runtime, one chat service, one service set, and at most one active library. IPC payloads never choose a session or window identifier. Global normalized configuration, media-tool availability, the provider file, and the last successfully opened library path remain coordinator-owned.

Launching more windows therefore does not create more Electron or Chromium profile owners. Different window sessions may hold different library locks concurrently. The coordinator additionally reserves `LibraryId` values so copied roots representing the same logical library cannot open in two windows even though their path-local lock files differ.

Supported media extensions:

- Images: `.jpg`, `.jpeg`, `.png`, `.bmp`, `.webp`, `.gif`.
- Videos: `.mp4`, `.mov`, `.mkv`, `.avi`.

An extension only determines scan eligibility. A record may still exist when its contents are damaged or its codec is unsupported; `Picture.ProbeStatus` or `Video.ProbeStatus` represents the technical parsing state.

### Windows Packaging

`electron-builder.yml` defines only the Windows x64 directory target. The personal desktop release is the complete `release/gui-win-x64-unpacked/` folder, launched through `ptmgr-gui.exe`; no installer, shortcut registration, or uninstall entry is generated. The package contains the main process, preload, shared schemas, shared backend and internal maintenance worker, the built renderer, and production dependencies inside `app.asar`. Sharp's native packages are unpacked. FFmpeg and FFprobe are copied as executable program resources to `resources/tools/ffmpeg/bin`; they are never stored in ASAR or copied to AppData.

The packaged runtime distinguishes the code root from the program-resource root. The code root contains `app.asar` and is used to load the renderer, preload, and maintenance worker. The program-resource root is the repository root in development and `process.resourcesPath` when packaged. `PHOTO_MANAGER_RESOURCE_ROOT` passes that real directory to maintenance child processes, which also use it as their working directory. Development commands fall back to the repository root when the variable is absent. This prevents executable lookup and child-process working directories from resolving inside the read-only ASAR virtual filesystem.

`npm run pack:gui` builds the renderer and the GUI directory. `npm run pack:cli` builds a separate `release/cli-win-x64-unpacked/` containing `ptmgr.exe`, `resources/app/src/{core,shared,cli}`, Node-compatible production dependencies, geographic time-zone data, FFmpeg/FFprobe, and CLI documentation. The CLI executable uses Node.js 24.19.0 SEA with a console subsystem. It locates resources relative to its executable, not the working directory. It does not ship or start Electron, the renderer, or Assistant. Keep either package intact when moving it.

`npm run pack:win` builds both packages. `npm run dist:win` tests first, then builds both. Neither creates an installer. Builds require materialized Git LFS FFmpeg files. User configuration remains in AppData and library data remain in their selected roots. The CLI shares general processing configuration without touching Electron profiles or last-library state.

### GUI and CLI separation

`src/cli` owns strict command parsing, terminal prompts, stdout/stderr formats, exit codes, and Ctrl+C. `src/core` receives explicit paths/options/progress callbacks/signals and never imports Electron, CLI parsing, or renderer code. The GUI calls the same core functions through its main-process services and internal worker; it never executes `ptmgr.exe`. CLI maintenance acquires its own exclusive lock. Only the private GUI worker passes an explicit parent session ID; inherited environment variables cannot grant the CLI access to an active GUI library.

`library-services.js` assembles shared query, metadata-edit, registry and location services. `library-persistence.js` owns backup-before-write and recoverable commits. `library-session.js` provides strict shared index loading and the short-lived CLI session lifecycle; the GUI keeps its existing per-window ownership. CLI edits validate the complete batch and preserve technical metadata before one atomic write. Registry deletion reuses the GUI transaction and child-detachment rules. No compatibility parser or alternate data schema is introduced.

## IPC Contract

Assistant adds the `chat:*` request allowlist and `chat:event` updates through `photoManagerApi.chat`. Its main-process services, renderer composable, provider boundary and cancellation lifecycle are documented in [Viewer Chat Implementation](../agent/implementation.md).

Web search adds `chat:searchConfiguration`, `chat:saveSearchConfiguration`, `chat:testSearch`, and `chat:openSource`. The last accepts only `sessionId/sourceId`; the owning main service resolves and validates the stored URL for the system browser. Send includes an explicit Boolean `webEnabled`, while stored attempts record availability through their tool contracts. All commands retain sender/frame isolation.

Request groups: `app:get-config`; `library:*` lifecycle, cancellation, directories, and info; `maintenance:start/show-output`; `gallery:query`; `photo:update-customization/batch-update/delete-media`; list/create/update/delete-global for four registries; single and batch clipboard/system media actions including `photo:copy-file/copy-files`; `photo:report-playback`; and `window:action/get-state`. Events are `library:state-changed`, `library:progress`, `maintenance:progress`, and `window:state-changed`.

Media IPC targets `mediaId`/`mediaIds`. Persisted IDs are PascalCase, mutation payloads camelCase, and each channel rejects unknown fields and obsolete PascalCase aliases. `FilePath` is never an action target: the main process resolves `MediaId` through its current index and verifies the resulting path remains inside the active library before any filesystem operation.

IPC registration requires sender-session routing and a mutation coordinator. The registrar explicitly lists channels that enter the owning session's mutation queue; reads and cancellation remain independent. Gallery responses contain only `total` and `groups`. The unused private `acceptChanges` chat-send flag is removed; exact-source rejection and explicit input exclusion remain unchanged.

## Source Responsibilities

### `src/core/`

- `application-paths.js`: roaming/local paths and pre-ready Electron storage setup.
- `program-paths.js`: development/packaged program-resource root resolution and worker propagation contract.
- `application-config.js`: complete defaults and shared strict configuration loading.
- `library-core.js`, `library-access.js`, `library-lock.js`, `library-backup.js`, `library-transaction.js`, `media-deletion-transaction.js`: boundaries, authorization, locking, snapshots, atomic writes, registry transactions, media-file staging, and recovery.
- `operation-progress.js`: callback-based structured operation reporting; the GUI worker lives under `src/main`.
- `common.js`, `library-data.js`: scanning, hashing, record creation, registry loading, and reference validation.
- `media-tools.js`, `media-time.js`, `thumbnail-cache.js`: FFmpeg execution/normalization, reference-time-zone logic, and thumbnail queues.
- `video-first-frame.js`: shared first-frame stream selection, orientation/aspect normalization, and cancellable FFmpeg execution for thumbnails and covers. `video-cover-cache.js` owns the separate derived cover cache; generation is available only through explicit maintenance/CLI operations.
- `init-metadata.js`, `update-metadata.js`, `verify-metadata.js`, `build-thumbnails.js`, `build-video-covers.js`, `export-metadata-csv.js`: maintenance operations.
- `gallery-query.js`, `metadata-edit-service.js`, and registry/catalog modules: shared queries, user-field edits, and registry operations.

### `src/main/`

Electron window/session routing, IPC, viewer resources, media-file deletion, Assistant, and application state. `maintenance-worker.js` adapts private worker IPC, parent-session authorization, and cancellation into explicit core operation options. `main.js` assembles shared services for each session using owner-scoped accessors. It retains GUI lifecycle and runtime enrichment.

### `src/cli/`

`arguments.js` validates syntax and per-command flags; `selectors.js` resolves IDs/names and gallery filters; `commands.js` adapts commands to shared services; `output.js` owns terminal serialization; `main.js` owns command lifecycle, locks, confirmation, cancellation and exit codes. The complete command contract lives under `docs/cli`.

### `scripts/`

Development launch and packaging only: `start-electron.js`, `pack-gui.cjs`, `pack-cli.cjs`, and the SEA bootstrap `cli-bootstrap.cjs`. Maintenance behavior lives in core and command parsing lives in CLI.

### `src/renderer/`

The renderer is a declarative `App.vue` shell, application composition root, state-owning composables, pure domain functions, and presentation components. Components consume narrow contexts and never reverse-import the composition root. Pure functions import no Vue/DOM/Electron; composables import no page components and collaborate only through callbacks/refs wired at the root.

Each renderer owns state for its window: library session; gallery query and stale-request suppression; full-result selection; shared media-deletion confirmation; viewer navigation/shortcuts; editor drafts/locks; media transform listeners/observer; video element lifecycle/preferences; one composable per registry; library-scoped recent history; window controls; and UI feedback. Every owner of a global listener, timer, observer, element, or IPC subscription exposes idempotent cleanup called on unmount.

Contexts are split into library, gallery, gallery-filter, viewer, settings, four registries, and UI feedback. Components render and forward intent. Shared picker/menu components retain their single-value, multi-value, filter, and hierarchy semantics.

Global CSS remains deliberate. `styles.css` alone imports tokens, library, base, gallery, viewer fields, registry controls, customization, viewer media, registry overlays, feedback, then responsive overrides. Keep tokens centralized, place rules with the DOM owner, preserve import order, and add a module only for a stable new visual responsibility.

For extensions: put deterministic algorithms in pure modules with `node:test`; give each state one lifecycle owner; coordinate cross-domain effects at the composition root; expose actions through the narrow existing context; use preload IPC only; use `shallowRef` for normalized full-result collections and separate edit drafts; verify listener cleanup during behavior-preserving refactors.

The application icon uses the blue stacked-photo artwork in `build/icon.svg`, shared with the agent-probe prototype. `build/icon.ico` contains Windows sizes from 16px through 256px and is used for executable resources and the BrowserWindow icon. Packaging must preserve executable resource editing so the icon is embedded; disable signing separately for unsigned local builds.

Chat tools separate context preparation, provider normalization, sequential run orchestration, tool registration/execution, proposal review and persistence. `chat:decide` accepts only a session/proposal identity and decision; there is no renderer-callable generic tool executor. Per-window `mutation-coordinator.js` orders library/registry/metadata mutations and chat acceptance. Acceptance acquires this queue before the chat queue, revalidates the proposal and commits metadata plus review state together. Read-only IPC remains independent. See [agent module ownership](../agent/implementation.md).

Window-close messages are presented through `window-messages.js` and the shared renderer dialog. Preload registers readiness and returns request-ID-bound decisions; main validates the owning webContents and main frame. Renderer loss cancels pending decisions. Native message boxes are an emergency fallback when the renderer is unavailable or unresponsive. Main retains authority over maintenance blocking, initialization cancellation, and safe session shutdown.
