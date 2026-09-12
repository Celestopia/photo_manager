# Viewer Chat Implementation

Viewer chat is implemented in v0.28.0. This page describes the code and its validation. The [interface](interface.md), [input processing](inputs.md) and [session storage](sessions.md) pages own the corresponding behavior contracts. See [Using Assistant](usage.md) for configuration instructions.

## Provider Configuration and Requests

`application-paths.js` resolves `%LOCALAPPDATA%/PhotoManager/app-data/chat-provider.yml`. Settings creates it on first access. The centered ProviderSettings dialog edits a sanitized configuration draft through preload; the main process validates and atomically saves it. Stored keys and environment values never return to the renderer. A blank replacement preserves the saved key, and removal is explicit. Save and open make no provider request; Test connection uses a synthetic image and reports explicit connection success or failure in a floating banner.

`chat/provider.js` accepts strict `schemaVersion`, `baseUrl`, `apiKey`, `apiKeyEnv`, `model`, `streaming` and optional `enable_thinking` fields. An explicit key takes precedence over the named environment variable. The default model is `qwen3-vl-plus-2025-12-19`, verified against [Alibaba Cloud's official model listing](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/qwen3-vl-plus). The base URL starts empty so the user must select the endpoint for their account and region. There is no automatic model fallback or model download.

Use HTTPS for public APIs; HTTP is allowed for loopback and private IPv4 servers. URLs cannot contain credentials, query parameters or fragments. Requests append `/chat/completions` to the configured base URL and do not follow redirects. Compatible user-operated local VLM servers use the same contract.

Only one provider request runs at a time, including the connection test. Requests have a 60-second timeout and a 4,096-token output limit. The transport handles complete JSON responses and streamed SSE, bounds response size and UI updates, and rejects incomplete streams. HTTP errors report their status and next steps without exposing raw response bodies, transport details or credentials. Retries require an explicit user action.

## Main-Process Responsibilities

`main.js` only wires the service to the active library, registered metadata, media-tool paths and window events.

| Module under `src/main/chat/` | Responsibility |
| --- | --- |
| `schema.js` | Exact session/message/attachment/request keys, UUIDs, states and references. |
| `store.js` | Library-owned paths, atomic JSON writes, imports' file ownership, recovery, listing and deletion. |
| `inputs.js` | File inspection, fingerprints, optimized images, unchanged originals, timed GIF/video samples and visual-slot allocation. |
| `metadata.js` | Resolve enabled saved metadata and assigned registry names; never expose unsaved drafts or mutate records. |
| `provider.js` | Validate machine-local configuration and send bounded multimodal requests. |
| `service.js` | Serialize mutations, assemble bounded conversation context, check source changes, record uploads and coordinate cancellation. |
| `ipc.js` | Validate the main-window sender, expose chat actions and own native file/confirmation dialogs. |

Media inputs use the existing indexed `MediaId` resolver. External files enter only through the native picker or pasted File objects; preload resolves native File paths. Clipboard blobs are bounded byte arrays. The renderer never receives provider keys or arbitrary filesystem access.

Sharp receives image buffers rather than cached source file handles, allowing Windows to delete imported attachments immediately after use. BMP derivatives use the bundled FFmpeg decoder before Sharp normalization. Moving-media extraction uses cancellable child processes and waits for their termination. A video's last target accounts for its frame interval so a low-frame-rate video is not sampled beyond its last frame. GIF targets use cumulative delays; if several targets land on the same displayed frame, remaining distinct source frames fill the allocation in source order.

Temporary upload images live in request memory and are released after the request. No derivative or base64 payload is persisted. Source hashes are checked before preparation and dispatch; the exact sent metadata, dimensions, sizes, transformations and timestamps are recorded in the session.

## Saving and Lifecycle Boundaries

The active library's exclusive lock covers chat writes. A serial operation queue prevents simultaneous session mutations; during a reply, conflicting operations ask the user to stop it first. Streaming checkpoints save no more than once per second. The final state is saved after earlier checkpoints finish, so an old checkpoint cannot overwrite a completed reply.

Library open recovers interrupted sessions and retries pending trash cleanup. A chat recovery failure is isolated from normal library browsing. Viewer navigation, closing Assistant, library closure, maintenance and application exit stop active work. Library closure and maintenance drain chat operations before releasing or transferring library ownership. Shutdown saves the stopped reply before releasing the library lock. On a crash, the next open marks unfinished replies Interrupted without automatically resending them.

Session deletion first stops and drains active work, then moves the session into its library-local trash folder. Cleanup removes only that session's validated directory. Failed cleanup remains visibly pending and is retried on library open. Original media and registries are never deletion targets. See [session storage](sessions.md) for the exact layout and retention rules.

## Renderer Responsibilities

The application composition root creates `use-chat.js` and provides `CHAT_CONTEXT`. The composable owns the active session, composer, history, options, errors and IPC subscription. Library changes reset its library-scoped state. Viewer navigation drains imports and submissions, stops generation, abandons unsent inputs and prepares a new draft for the current medium. A generation counter prevents superseded transitions and previews from publishing stale state. The abandon IPC checks stored messages before deleting a draft; it never deletes a submitted conversation. History excludes drafts while recovery enumerates all records for cleanup. Reactive send values are converted into plain serializable objects before crossing preload.

`ViewerView.vue` keeps the metadata fields mounted while showing `ChatPanel.vue`, preserving draft edits. `ChatPanel.vue` renders the conversation and forwards actions to the composable. Settings and metadata choices sit behind Options beside the composer. Processing notices remain visible before Send. Invalid visual allocations and oversized original images disable Send with an explanation.

`chat-markdown.mjs` uses Markdown-it with HTML disabled. Links render as inert underlined text, and image references render as text rather than automatically loading external assets. This release intentionally does not navigate links from model replies. `styles/chat.css` owns the panel's styles.

## Validation

`tests/chat.test.js` covers strict persistence, corrupt sessions, link/path rejection, original-byte equality, optimized orientation/size, input validation, GIF timing/composition, video sampling, provider errors, bounded history, changed/missing sources, independent attachment ownership, stopped streams and explicit retries. Synthetic video tests include a 30-minute file and use bundled CPU media tools. `tests/chat-renderer.test.mjs` checks Markdown formatting and inactive HTML/links/images.

`tests/helpers/chat-ui-smoke.cjs` runs a hidden, offscreen Electron window against an isolated temporary library and a loopback fake provider. It exercises the actual renderer/preload/main bridge: open Assistant without network traffic, IME-safe Enter, Send, Markdown, original upload, Stop, History, pasted images and deletion. It verifies that library metadata stays unchanged. It writes a screenshot under ignored `release/` and prints its isolated temporary-data directory for cleanup after Electron exits.

Run the checks with:

```powershell
npm test
npm run build:renderer
node_modules/.bin/electron tests/helpers/chat-ui-smoke.cjs
npm run pack:win
git diff --check
```

Also run `node --check` on changed CommonJS files. Metadata verification always requires an explicit synthetic or user-selected test library. Fake-provider tests establish the request and lifecycle behavior; they do not establish live Qwen answer quality. Live-provider validation still requires the user's configured credentials and an explicitly sent test input.

`tests/helpers/chat-package-smoke.cjs` loads chat modules from the built ASAR and tests packaged Sharp, bundled CPU FFmpeg and original-byte preservation. Run it with the packaged executable and `ELECTRON_RUN_AS_NODE=1` in a temporary shell. This does not exercise a live provider.

For a development package without network downloads, electron-builder can use `--config.electronDist=node_modules/electron/dist --config.win.signAndEditExecutable=false`. That offline smoke-test build skips executable resource editing and signing; use the normal release command for distribution.

Attachment descriptions include an ephemeral previewUrl for the composer. The main process prepares a bounded 160px JPEG locally from validated library or session-owned inputs; video uses a first-frame preview and GIF uses its first frame only for display. Preview failures fall back to a file icon. Previews are not persisted or included in model requests; video/GIF request sampling remains unchanged.

Provider requests always stream. The stored `streaming` field remains fixed at `true`; an existing `false` value is normalized at runtime and replaced with `true` on the next settings save. Non-streaming JSON replies are rejected with an explanation.
