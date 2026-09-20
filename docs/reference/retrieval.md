# Gallery Semantic Retrieval

Part of the [project specification](../../PROJECT.md). Gallery retrieval uses local visual and text embeddings. The LLM plans semantic queries; it cannot generate predicates, look up registry IDs, alter metadata, or browse the web. This replaces the rule-based retrieval attempt without a migration or compatibility layer.

## User interaction

The gallery Assistant opens a central floating dialog with a dimmed, blurred backdrop. It shares message rendering, copy, input, Send/Stop, provider settings and reported token statistics with viewer chat. It has no saved History, attachments, metadata proposals or web tools. Closing the panel leaves a running search active; the gallery may refresh behind it. The user closes the panel manually to browse results.

Results is an integer from 1 to 100, initially 10. This is authoritative application state: a different number in a prompt has no effect. A successful search returns the lesser of this count and the number of eligible indexed media, with no similarity cutoff or load-more action. These are approximate closest matches, not guaranteed semantic matches. Items with no usable vectors for any requested lane cannot enter the results.

Every search intersects the current visible gallery controls, including privacy and submitted free-text search. Non-default controls produce a warning in the panel; default privacy level 1 still restricts scope without a warning. Ordinary sorting is replaced by relevance order while a semantic query is active. Changing visible controls or Results reranks the eligible scope locally using the existing query vectors, without another LLM request. There are no exact agent-generated rating, date, dimension or other rules. For requests such as food with high rating, the planner searches food and explains that rating is not applied semantically; users can set ordinary rating controls themselves.

An active query summary and Clear search action appear above the gallery. Clear removes the semantic query; gallery Reset also clears it while restoring ordinary defaults. Both invalidate pending application from an older request. Stop preserves the last completed search. New chat clears temporary messages and usage but retains the active query and Results. New chat and Results changes are disabled during a request. There is no semantic Undo.

Conversations, query vectors, result count and summaries live only in the owning window's memory. Hiding the dialog or visiting a viewer preserves them. Closing/replacing the library or closing the window cancels work, releases workers and resets Results to 10. Separate windows are independent. No retrieval conversation files or recovery logs are saved. Viewer conversations retain their existing separate persistence. Videos open as whole media items at the beginning without autoplay; no matching-frame navigation or audio search is provided.

## Setup and model assets

Open Settings > Build Semantic Index. Explicitly download the two pinned quantized model families (about 278 MiB), or import a folder containing their repository/revision subdirectories, then start indexing. Model installation requires 1 GiB free space. Downloaded partial files can resume; size and SHA-256 validation precede publication. A failed checksum is never accepted. The checked-in `src/main/semantic/model-manifest.json` specifies repository revisions, filenames, sizes and hashes; import must match that exact layout and manifest.

Assets live at `%LOCALAPPDATA%/PhotoManager/models/<repository>/<revision>/` and are shared across windows. The coordinator serializes installation; model files are never downloaded during search or library opening. The executable includes the inference runtime but not the weights. Transformers.js is local-only during inference. Quantized CLIP supplies 512-dimensional image/text vectors; multilingual MiniLM supplies 384-dimensional metadata/query vectors. All vectors are unit normalized, finite Float32 values. CPU inference uses two intra-operation threads and one inter-operation thread, with one encoder loaded at a time and a 60-second idle release.

The configured chat provider receives the user's conversation, complete semantic query and small tool outcomes. It receives no gallery media, registry records, projected metadata documents or stored vectors. Local model download is a separate explicit network operation. Viewer media uploads follow their existing consent and input-selection rules.

## Indexed inputs

The pure projection in `src/main/semantic/domain.js` creates three independent lanes:

| Lane | Inputs | Weight |
| --- | --- | --- |
| Visual | Original image pixels or sampled video/GIF frames | 0.5 |
| Description | Title, Description, assigned tag names and descriptions | 0.3 |
| Context | Assigned people and album names/descriptions, administrative region, parent-first location path and ancestor descriptions, Location.Detail | 0.2 |

HiddenDescription, filename, relative path, rating, privacy, capture dates, dimensions, file size and duration are not included in text projections. Empty text lanes are omitted. Unicode is normalized to NFC, whitespace is normalized, values are quoted, and multi-value registry references are ordered by stable UUID. Registry changes affect only media projections that depend on them. Visual fingerprints use the recorded content SHA-256 plus a preprocessing/sampling/model profile; text fingerprints use projected text plus the model/projection/chunking profile. Independent fingerprints avoid unnecessary lane rebuilds.

Text is split at tokenizer boundaries into at most 126 content tokens, with up to 16 tokens of overlap. Each decoded chunk is rechecked against the 128-token encoded limit, and all chunks are embedded; long documents are not silently truncated. The visual query is limited to 77 CLIP tokens. Original-language names/numbers such as 613 dormitory remain in text queries; visual descriptions are concise English.

Images are decoded with orientation and aspect ratio preserved, converted to sRGB, and resized for inference without center cropping. The CLIP input is letterboxed to 224 × 224 with the model-mean background. Transparent pixels flatten onto white. GIFs use up to eight distinct frames selected uniformly by presentation time.

### Video sampling

Videos are retrieval units, not collections of independently returned frames. Internal visual vectors preserve scene coverage. For duration D in seconds, the target sample count is:

| Duration | Target frames |
| --- | --- |
| 0 < D < 10 | 10 |
| 10 ≤ D < 60 | ceil(2D/5 + 6) |
| 60 ≤ D ≤ 600 | ceil(D/6 + 20) |
| D > 600 | 120 |

FFprobe uses two decoder threads and enumerates actual presentation timestamps from structured JSON frame objects; rotation-matrix and other side data are never parsed as frame timestamps. Choose distinct source-frame indices nearest uniformly spaced times from first to last frame, reserving enough frames for later targets. Cap the count by the actual decoded frame count. Thus a clip with fewer than ten frames uses every available frame; identical-looking source frames remain distinct samples. Variable frame rates do not cause nominal-FPS duplicates. FFmpeg selects those indices in one decode pass, grouping selection terms to stay below its expression-parser recursion limit even at 120 samples.

FFmpeg selects those indices in one extraction pass, normalizes display aspect/orientation and writes bounded images (longest edge at most 1024) to an owned temporary directory under the library. The builder embeds one image at a time and removes the directory in a finally block. Probing/extraction each have a 30-minute process limit and a 32 MiB output limit; a failure is reported without replacing prior usable vectors. Decode failures may publish partial coverage, retried by later manual builds. There is no whole-video duration exclusion. Sampling never uses gallery thumbnails or viewer covers.

## Manual indexing and storage

Only Settings > Build Semantic Index or the explicit-library CLI changes the index:

```powershell
npm run build-semantic-index -- --library "D:\Media\My Library"
npm run build-semantic-index -- --library "D:\Media\My Library" --force
```

Close the library in the application before standalone CLI use. The command shares library boundary checks, strict metadata/registry loading, recovery guards, configuration, progress reporting and the exclusive library lock. Models must already be downloaded/imported for the current account. The GUI uses this same maintenance operation over the entire library, regardless of gallery filters. Indexing does not edit media, metadata, registries, thumbnails or covers.

The maintenance entry point validates the complete registry bundles returned by `loadRegistryIndexes`, then explicitly passes each bundle's `byId` map to semantic projection. The projection and status paths share the same ID-map contract for albums, tags, people and locations. This is an internal data handoff, not a persisted schema conversion.

Normal builds reuse complete lanes whose fingerprints, profile and vector object validate. Missing, changed, incomplete or damaged lanes are rebuilt. Rebuild/`--force` attempts every lane and can replace an invalid derived manifest; it is not a schema migration. Failed replacements preserve existing usable lanes. Same-input partial retries retain good previous samples. Deleted media are removed during explicit maintenance and are already excluded from search by current MediaIds.

Index files are derived, disposable and excluded from automatic authoritative-data backups:

```text
.photo_manager/semantic/
  current.json
  generations/<UUID>.json
  objects/<SHA256>.f32
```

`current.json` has exactly `version: 1`, `generation` (UUID v4), and `hash` (manifest SHA-256). A generation has exactly `version: 1`, `libraryId`, `entries`, `createdAt`. Each entry has exactly `mediaId`, `lane`, `profile`, `inputHash`, `blob`, `count`, `expected`, `parts`. Parts identify distinct sample/chunk indices; count is the number of stored vectors and expected is the target coverage. Objects contain packed little-endian Float32 vectors with lane-specific dimensions. Readers validate library identity, schema, IDs, profiles, object checksums, dimensions, finite values and unit norms. Corrupt indexes report an explicit rebuild error; incompatible profiles are not searched. No aliases, old schemas or implicit repair are accepted.

The builder writes immutable vector objects, then a generation manifest, then atomically replaces the pointer. It checkpoints after at most 32 attempted lane builds and at completion/cancellation, retaining completed work for subsequent runs. The last published generation remains readable if a later write fails. Existing search workers are stopped and awaited before maintenance; successful maintenance prunes unreferenced known generation/vector artifacts while retaining the current and previous publication. Failed/cancelled builds may leave harmless unreferenced derived files for later maintenance. No pruning occurs during reads.

Metadata edits and registry changes never build embeddings. Previously built compatible vectors remain searchable even if their input fingerprints are now different. Only opening the Build Semantic Index options panel compares current projections and shows missing, partial and outdated counts. No outdated badge or background fingerprint scan appears in chat, the gallery, or the viewer. This notice reflects indexed metadata snapshots, not unseen external filesystem edits; run Update Metadata to record those first.

## Ranking and planner lifecycle

The provider has one tool, `semantic_search`, with exactly three strings: `visualQuery`, `descriptiveQuery`, `contextualQuery`; each is at most 2000 characters and at least one must be nonempty. Every invocation supplies a complete replacement query, whether a new request or refinement. The LLM decides conversational intent. There are no registry-reference tools, count argument, arbitrary predicates or executable code.

One valid search is allowed per user message. One extra provider completion may correct an invalid query format or overlong visual query. A successful search receives an application-generated summary and count without another provider request. Clarification text without a tool leaves current results unchanged. Failures and Stop preserve previously completed results. Input is limited to 8000 characters and the temporary conversation to 100 messages; provider history is a suffix of complete exchanges capped at 48 KiB, with current semantic intent supplied separately. Requests have a five-minute deadline. Usage uses provider-reported values, including partial streamed usage.

The query is embedded locally once. For each available requested lane, a worker computes the maximum cosine similarity across that media's sample/chunk vectors and the query chunks. Per-lane item rankings are fused using weighted reciprocal-rank fusion: sum(weight / (60 + rank)), where rank starts at 1. Missing lanes contribute zero; weights are not redistributed. Media IDs break ties deterministically. Each video or animated image occupies one result slot. The worker scans the current eligible IDs and returns unique ranked IDs; main enforces Results independently of the LLM.

Ranking uses an exact scan, not an ANN database. It validates immutable objects once per loaded generation and retains at most 256 MiB of vector data; larger indexes stream remaining objects during scans. The worker reloads when the generation changes and is released on maintenance or library closure. Search never rehashes source video files or regenerates missing data. Result revisions and library-generation checks discard stale work. A pending planner uses the latest visible controls when applying; Clear/Reset and library replacement block older applications.

## Ownership and verification

- `src/main/semantic/domain.js`: projections, fingerprints, query/count contracts and frame selection.
- `model-assets.js`, `model-manifest.json`: explicit verified assets.
- `local-embedding-service.js`, `embedding-worker.mjs`: serialized cancellable CPU inference, Electron utility process or CLI worker thread.
- `media-assets.js`, `index-builder.js`, `index-store.js`: sampling, incremental manual builds and strict atomic snapshots.
- `search-service.js`, `vector-search-worker.js`: query encoding, bounded cached scans and ranking.
- `src/main/retrieval/service.js`: window-local conversation, planner and gallery query state.
- `scripts/build-semantic-index.js`: shared explicit-library maintenance entry point.
- `use-retrieval.js`, `GalleryAssistant.vue`: temporary assistant state/presentation using shared chat components.
- `use-semantic-index.js`, `SemanticIndexOptions.vue`: explicit setup/status/progress UI.

Preload exposes sender-routed `retrieval:snapshot/send/stop/control/setLimit`, `retrieval:event`, and `semantic:status/install/cancel/progress`. Renderer code never handles paths, model files or vector bytes directly. Model installation is globally serialized; conversations, workers, query caches and library indexes remain session-scoped.

Unit tests cover projection exclusions, sampling boundaries, distinct source frames, fixed count, clarification, bounded corrections, stale requests, window isolation, partial snapshots and corruption. FFmpeg tests create synthetic clips and check actual frame counts, rotation side data, aspect, cleanup and the full 120-frame selection expression. A disk-backed maintenance regression assigns all four registries, including parent/child locations, and checks all three embedding lanes plus unchanged metadata and unknown-reference rejection. The isolated Electron gallery smoke uses assigned registry fixtures and verifies hidden completion, shared copy/usage/settings, count reranking, Clear/Reset, warnings and absence of media writes or saved conversations. Viewer chat smoke checks shared component regressions; package smoke exercises real local model inference from the built runtime. Retrieval quality is an MVP limitation: no quality gate, exact-condition enforcement, reranker, frame-level results or automatic index updates are provided.
