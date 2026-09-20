# Gallery Semantic Search

Part of the [project specification](../../PROJECT.md). This is a local keyword-search module. There is no gallery agent, conversation, provider request, query rewriting, or generated filter logic. Viewer Assistant remains a separate feature.

## User interaction

Gallery search modes are Title, File name, Description, and Semantic. Every mode submits only on Enter or Search. The renderer's `use-gallery-query.js` owns separate draft and applied queries. Typing and mode selection change the draft; filters, sorting, maintenance refreshes, metadata edits, and viewer return use the applied query. Enter during IME composition only confirms input. Successful submissions replace applied state; stale responses cannot overwrite newer requests or another library.

Semantic mode adds Results **after** Search. The integer range is 1–100, initially 10; main independently validates it. It resets on library closure/replacement and Reset Gallery. Returning from a viewer preserves it. There is no load-more control. Changing Results reruns the applied semantic search using cached query vectors; it never submits draft text. An applied-search summary distinguishes displayed results from the draft.

Empty submission or Clear Search restores ordinary browsing under current filters and saved ordinary sort settings. Clear keeps the draft mode and Results value. Reset Gallery restores all gallery defaults. Cancel stops pending inference/ranking and refreshes the last applied query. Failure preserves the last valid applied query, but filter changes clear potentially excluded results before refresh. There are no saved search histories or queries.

Semantic text is trimmed and NFC-normalized; the complete keyword phrase is encoded without translation, per-word Boolean logic, or inferred commands. Chinese, English, mixed text and names/numbers are accepted. Input is limited to 2000 characters and each encoder's 128-token limit; overflow asks the user to shorten the phrase, never silently truncating it. Ordinary modes retain their existing literal case-sensitive substring rules.

Use phrases such as `海边 日落 风景` or `sea sunset scenery`. Exact rating, date, exclusion, sorting, or result-count instructions inside text are not interpreted. This MVP returns approximate nearest matches; improving precision is future work.

## Models and local inference

`src/main/semantic/model-manifest.json` pins repository revisions, filenames, byte sizes and SHA-256 checksums. Explicit Download Models or Import Model Folder prepares weights under `%LOCALAPPDATA%/PhotoManager/models/<repository>/<revision>/`. Downloads resume partial files and validate them before publication. Model installation requires 1 GiB free space and is serialized by the coordinator. Search and library opening never download models.

Three model roles are used:

| Role | Model and output |
| --- | --- |
| Photos/video frames | Quantized CLIP ViT-B/32 vision encoder, 512 dimensions. |
| Keywords for visual matching | Sentence Transformers CLIP-ViT-B-32-multilingual-v1, unsigned-int8 AVX2 ONNX export plus upstream dense projection, 512 dimensions. |
| Metadata and keywords for metadata matching | Quantized multilingual MiniLM-L12-v2, 384 dimensions. |

The multilingual CLIP adapter uses the upstream tokenizer, ONNX token features, masked mean pooling, and the learned 768-to-512 weight matrix, followed by L2 normalization. `multilingual-clip.mjs` validates the safetensors header, matrix shape, finite weights and graph output dimensions. It does not mistake unprojected transformer features for CLIP vectors. Artifacts are immutable local inputs; no remote code is executed. ONNX Runtime is explicitly included as a production dependency and unpacked for Electron.

Metadata documents are encoded in token-bounded overlapping chunks; short query metadata is encoded once and reused for description and context matching. All vectors are finite normalized Float32-compatible values. Images are orientation-corrected, flattened, scaled and letterboxed to CLIP input dimensions without center cropping. The image model is unchanged when only the multilingual query encoder changes; index fingerprints identify the models/preprocessing that actually produced indexed vectors.

The embedding worker is an Electron utility process in the application and a worker thread for standalone maintenance. CPU sessions use two intra-operation threads and one inter-operation thread. Both query encoders can remain loaded for repeated searches; all loaded sessions are released after 60 seconds idle. Image indexing releases query sessions rather than retaining all models together. Work is serialized and cancellation terminates the worker, rejecting pending calls. Python is not an end-user dependency.

## Indexed information and video sampling

| Category | Inputs | Ranking weight |
| --- | --- | --- |
| Visual | Original photo pixels or sampled video/GIF frames. | 0.5 |
| Description | Title, public Description, assigned tag names/descriptions. | 0.3 |
| Context | Assigned people and album names/descriptions, parent-first location hierarchy/descriptions, administrative region and Location.Detail. | 0.2 |

HiddenDescription, paths/filenames, ratings, privacy, capture dates, dimensions, file size and duration are excluded from text projections. Registry values are resolved from strict validated UUID `byId` maps. Empty text categories are omitted. One usable indexed category is sufficient to participate; absent categories contribute no artificial vector.

Videos are whole-media results; sampled frames are internal evidence, never individual hits or seek targets. Viewer playback starts at the beginning without autoplay. Target sample counts for duration D are:

| Duration | Distinct frames |
| --- | --- |
| 0 < D < 10 seconds | 10 |
| 10 <= D < 60 | ceil(2D/5 + 6) |
| 60 <= D <= 600 | ceil(D/6 + 20) |
| D > 600 | 120 |

Counts are capped by actual frame availability. FFprobe uses two decoder threads and structured JSON presentation timestamps, excluding rotation side data. Select distinct source frames nearest uniformly spaced times. FFmpeg decodes in one extraction pass and groups selection expressions to stay below parser recursion limits at 120 samples. Temporary PNGs preserve display orientation/aspect with a longest edge up to 1024; the owned temporary directory is removed in `finally`. GIFs sample up to eight frames. Probing/extraction use bounded output and 30-minute timeouts. Gallery thumbnails and viewer covers are never semantic sources.

## Filtering, ranking and lifecycle

`gallery:query` passes validated mode/text and result limit to `semantic/gallery-search.js`. Ordinary searches use the existing deterministic query service. Semantic queries encode their text, apply the same visible filters without literal text matching, and pass eligible MediaIds to the ranking worker. Privacy is enforced before ranking and rechecked with current metadata before publication. A filter change reranks the eligible set before taking N, rather than filtering a previously truncated set.

The ranker computes maximum cosine similarity over each item's frames/chunks per category. Category rankings are combined with weighted reciprocal-rank fusion, `sum(weight / (60 + rank))`, using one-based ranks. Missing categories contribute zero without redistributing weights. MediaId breaks ties. Return unique media up to the UI limit, with no similarity threshold or confidence percentage. Weak matches can appear when they are the closest available items.

Semantic results use a flat relevance-ordered grid, with Relevance replacing date-sort controls. Ordinary date sorting/grouping returns on clearing semantic search. Viewer navigation and batch selection follow the displayed result set.

Main owns inference and eligible IDs; renderer cannot access Node, file paths, or choose another window's session. Query workers, current-query embedding caches and ranking data are library-session scoped. New requests cancel predecessors; library identity/revisions prevent late publication. Closing/replacing a library or entering maintenance aborts work and disposes caches. The ranking worker reloads on index-generation changes and caches at most 256 MiB of vector data; remaining objects are read during scans. Exact scanning is used, with no vector database. Search never hashes or decodes original media or creates missing embeddings.

## Manual index maintenance

Only Build Semantic Index or the explicit-library CLI updates vectors:

```powershell
npm run build-semantic-index -- --library "D:\Media\Example Library"
npm run build-semantic-index -- --library "D:\Media\Example Library" --force
```

Close that library in the desktop app before standalone CLI use. Both routes share strict loading, validated registry handoff, path/symlink checks, recovery guards, configuration, exclusive locking and progress/cancellation. They build the whole library independently of visible filters and do not modify original media, metadata, registries, thumbnails or covers.

Normal builds reuse complete categories whose profile, input fingerprint and vector objects validate. Missing, changed, incomplete or corrupt objects are rebuilt. Force rebuild attempts all categories; failed replacements preserve usable prior work. Source content is checked during visual builds. Cancellation checkpoints completed work. Model/preprocessing identity and source hashes determine visual fingerprints; projected text and model identity determine metadata fingerprints.

Editing metadata never regenerates vectors automatically. Compatible existing snapshots remain searchable until a manual update. Only the Build Semantic Index panel shows fingerprint-based outdated counts. Deleted MediaIds are immediately excluded from search, with object pruning during explicit maintenance.

Derived files live under `.photo_manager/semantic/`: `current.json`, `generations/<UUID>.json`, and `objects/<SHA256>.f32`. The pointer contains exactly version, generation, hash. A generation contains version, libraryId, entries, createdAt. Each entry contains mediaId, lane, profile, inputHash, blob, count, expected, parts. Strict readers validate identities, dimensions, hashes, counts, finite normalized vectors and contained nonsymlink paths. Atomic publication precedes pruning; derived indexes are excluded from authoritative backups. There is one current schema and no experimental-format migration. Prototype artifacts can be removed explicitly and rebuilt.

## Ownership and verification

- `scripts/build-semantic-index.js`: CLI/maintenance boundary, locking and registry validation.
- `semantic/domain.js`, `index-builder.js`, `index-store.js`, `media-assets.js`: projection, sampling, snapshots and reuse.
- `model-assets.js`, `model-manifest.json`, `multilingual-clip.mjs`, `embedding-worker.mjs`: verified models and local inference.
- `gallery-search.js`, `search-service.js`, `vector-search-worker.js`: direct query validation, cancellation, encoding and ranking.
- `use-gallery-query.js`, `GalleryView.vue`: all-mode draft/applied state and explicit submission.
- `SemanticIndexOptions.vue`, `use-semantic-index.js`: model/index maintenance controls.

Tests cover draft isolation in all four modes, IME, limits, resets, cancellation, privacy/eligibility before limiting, stale libraries, projection math, registry references, sampling boundaries/rotation/120-frame selection, atomic index contracts and metadata preservation. `tests/helpers/semantic-search-ui-smoke.cjs` runs isolated Electron controls and real local inference without an LLM provider; run after `npm run build:renderer` using Electron. Packaged-runtime checks verify model loading and scans from ASAR with unpacked native dependencies. Real-library trials require an explicitly authorized test library and hash checks on authoritative data. Precision tuning is not a release gate for this MVP.
