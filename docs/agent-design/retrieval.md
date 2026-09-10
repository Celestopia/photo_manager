# Retrieval and Index Specification

Status: planned implementation. Part of the [agent design](README.md); current application behavior is in the [implemented reference](../../PROJECT.md).

## 1. Representations

Use exactly three vector lanes: visual, descriptive text and contextual text. Both text lanes use local multilingual MiniLM-L12-v2 (384D); the visual lane uses local CLIP ViT-B/32 (512D). Exact model/runtime details are in [local-embeddings.md](local-embeddings.md). Keep their vectors separate. Exact metadata and a local lexical lane supplement them.

For every MediaId construct two labelled text documents from current authoritative records:

- Description: Title, Description, HiddenDescription, assigned tag names and each assigned tag's Description.
- Context: assigned people names/descriptions; album name/description; location Country/Province/City, full parent-first path and every referenced ancestor description; Location.Detail; relative FilePath.

These include all current descriptive schema fields. There is no current GPT metadata field: do not add a compatibility alias; if GPT content is stored in an existing description, that text already participates. Other technical fields remain tool-readable. Capture time, GPS, IDs, rating/privacy and media type remain exact structured fields, not invented prose. Registry UUIDs remain authoritative; embedded display text is disposable derived data.

Use fixed English field labels to distinguish evidence source, NFC normalization, LF newlines, trimmed field boundaries, and collapse runs of horizontal whitespace. Preserve case, accents and user language in embedding input. Omit empty values and omit entirely empty documents. Sort unordered registry assignments by UUID before serializing. Encode each field with JSON string escaping so text cannot spoof structural labels.

Use the tokenizer-aware 126-content-token chunks with 16-token overlap specified in local-embeddings.md. Include field labels within the budget, preserve spans and embed all chunks; do not silently truncate long metadata. Store hashes and source spans, not duplicate plaintext projections, on disk.

Initial viewer context includes MediaId, media type, relative filename, title, description, tag names, assigned location path and resolved shooting time; cap individual free-text previews at 1,000 code points and expose field paging. People, hidden description and other fields are available on demand. Indexing includes descriptive fields automatically regardless of initial chat disclosure.

## 2. Pixel preparation

For local CLIP, derive a full-frame 224x224 letterboxed input with the pinned normalization and no center crop, as specified in local-embeddings.md. The following larger derivative is for optional selected cloud Q&A only.

Images: Sharp auto-orient, convert to sRGB, composite transparency on white, fit inside 1,024 × 1,024 without cropping or enlargement, JPEG quality 85. If over 1 MiB, retry qualities 75 then 60, then dimensions 768 and 512 at quality 60; if still over limit, report failure. Decode limit 100 megapixels. Extreme aspect ratios use the entire frame; the verifier may request up to two explicit crops, which are temporary evidence, not the default index.

Videos: bundled FFmpeg/FFprobe, no live-player capture. Respect display rotation and sample aspect ratio. If duration D is in (0,1800] seconds, set:
- N = min(120, max(2, ceil(D/15)+1)).
- T = max(0, D-0.1).
- Requested timestamps t[i] = i*T/(N-1), i=0..N-1.
- Decode the first frame at/after each target, record actual presentation timestamp, deduplicate identical timestamp outputs. If a target is undecodable, record a missing sample; do not substitute a thumbnail vector.
- Encode derivatives with the image rules. Each frame receives its own vector.

This yields 5 samples for a 1-minute clip, 21 for 5 minutes, and 120 for 30 minutes. Sampling covers both ends. Store actual timestamps and expected/missing sample counts. Extraction has 60 seconds per attempt, one retry; cancellation terminates the child process. Long GOP decoding cost remains real.

Animated GIF: decode up to 8 frames uniformly over its complete animation duration, using the same endpoint formula with N=min(frameCount,8); store animation timestamps. A static GIF has one frame. If duration/frame decoding fails, mark animation visual coverage failed; do not mislabel its first frame as complete analysis. Do not implement audio or temporal models.

Visual cache key: media SHA256Hash + preprocessingVersion + samplingVersion + model profile fingerprint + timestamp/frame identity. Identical bytes share embedding computation while distinct MediaIds retain separate metadata and search membership. FilePath changes alone do not rebuild pixels. Metadata maintenance is still required to discover source edits; no watcher is added.

Before using a source, check active-library resolution, reject symlinks, and compare current size/mtime with the record. A changed file is unavailable pending Update Metadata. On explicit visual build, hash the source while reading; mismatch invalidates its visual tasks and requests maintenance. Never reassign a MediaId or update core technical data from the indexer.

Verification:
- Photo: one full derivative, then at most two additional crops if needed.
- Retrieved video/GIF: best 4 distinct indexed frames, chronological order; if a video scene is inconclusive, add up to 4 new frames spaced across the 10-second interval around the best timestamp, clamped to duration.
- Viewer video introduction and batch tagging: 8 uniformly spaced full-duration frames; one further 8-frame inspection is possible within the relevant window.
- Each request has at most 8 frames. A video may use at most 16 inspected frames per window. If the remaining window cannot fund the next inspection, pause before it; do not report a partially assessed item as confirmed.

## 3. Query interpretation and candidate generation

1. Freeze the current gallery query or explicitly chosen whole-library scope in main. Resolve it against all records.
2. The cloud planner receives only the typed query and a generic schema, never library metadata/tools. It produces a strict query-plan object: visualQuery, descriptiveQuery, contextualQuery, and a boolean predicate tree with at most 12 leaves/depth 3. Leaves have field, operator, value, policy (required/ordinary/preferred), and source user-text span. Supported fields: type, title/description/tag concept, tag/person/album/location UUID, location region/name, shooting date, rating/privacy, duration and explicit GPS radius. Operators: eq/in/range/contains/not; boolean all/any. No arbitrary expressions.
3. Validate the tree. Resolve current registry UUIDs through host tools; ambiguous identities pause for user choice. Display resulting scope and condition chips. Unsupported predicates such as spoken words are labelled unsupported; do not quietly drop them.
4. Apply deterministic hard predicates before ranking. Split ordinary location/date facts into matched, unknown and conflicting partitions, excluding established contradictions. Free-text claims do not become exact registry assignments.
5. Refresh missing/stale metadata chunks in this scope under the preparation budget. On incomplete refresh, stop with Continue / Search available index / Cancel. The reduced-coverage choice is explicit. No automatic visual-library build.
6. Embed all nonempty lane queries locally. The query-only planner supplies a concise English visualQuery for CLIP; local-query mode accepts English visual text directly and makes no cloud call. VisualQuery contains requested scene/object/appearance. DescriptiveQuery contains requested descriptive concepts. ContextualQuery contains place/person/album context. The same text embedder serves the latter two. Exact-only requests skip irrelevant vector lanes.
7. Exact scan every valid in-scope vector in a worker. Each lane score per MediaId is the maximum cosine over that item's chunks/frames, one vote per lane. Return top 200 unique MediaIds per lane. Retain up to 4 best frame timestamps as evidence.
8. Lexical retrieval uses current projected text, including unembedded changes: NFC + lowercase, Unicode letters/digits as words and CJK overlapping bigrams, BM25 k1=1.2 and b=0.75. Compute document frequency over MediaIds, not chunks; empty queries omit the lane. Top 200 unique media.
9. Add up to 200 exact-fact matches, sorted by count of matched requested facts then MediaId. Union candidates, rank, keep 600. If there is no semantic component, page exact matches by MediaId with no arbitrary semantic cutoff.

No lane serves as a prerequisite for another. Records supported only by pixels or only by metadata can enter. Candidate caps are retrieval budgets, not promises of all matches.

## 4. Fusion, verification and membership

Base fusion:
score = 0.50/(60+rVisual) + 0.30/(60+rDescription) + 0.15/(60+rContext) + 0.05/(60+rLexical).

Missing lanes contribute zero. Ranks are one-based after MediaId grouping. Add 0.002 per matched preferred exact predicate, capped at 0.006. Deterministic tie-breaker is MediaId. Ordinary known location/date matches form a priority partition ahead of unknowns, not a small embedding bonus. Separate user preferences from requirements.

Ordinary search performs no cloud verification. The host ranks local candidates and evaluates exact facts locally. Visual similarity alone never confirms a scene. Display visual candidates immediately with an unverified badge; cloud planning receives no candidates or local evidence. Optional Analyze selected with cloud creates a separate approved scope as specified in local-embeddings.md. Only then use the existing per-facet verifier (at most 40 selected media/window); its evidence cannot override exact predicates.

Final groups, in this order:
1. Matches: exact-only predicates verified locally, or all requested facets supported after explicit selected cloud analysis; never promote CLIP scores alone.
2. Metadata-supported: exact place/date constraints supported, a requested scene supported by direct title/description/tag assertion, but pixels inconclusive or unavailable.
3. Unknown location or date: requested ordinary place/date cannot be established, remaining facets supported or explicitly metadata-supported.
4. Conflicting evidence: mutually inconsistent positive claims; collapsed by default, excluded from match counts.
5. Visual candidates: locally ranked visual hits, unverified and expanded by default when there are no confirmed matches; never counted as visually confirmed.

Within a group preserve fusion score then MediaId. Exclude established mismatches entirely and show only their count. Strict requirements/exclusions remove unknown/conflicting facts for that strict predicate from the result membership, including auxiliary groups. “Prefer” never excludes.

Visual inconsistency is a positive contradiction only when the evidence supports it; failing to see a small/occluded object is inconclusive. A sampled video lacking an event cannot establish its absence over the entire clip. Do not accept whole-video absence/order/speech requirements as verified with this pipeline.

Registry descriptions describe the entity, not necessarily the photo: a person's surfing biography alone cannot support “this image depicts surfing”. Assigned person UUID means a metadata assignment, not face identification. For location:
- Assigned hierarchy/region fields establish registered location membership.
- Explicit title/description/detail claims are labelled textual location evidence.
- A different registered location can establish a mismatch only when the requested geographic relationship is actually known; a parent/child relationship is not a contradiction.
- GPS alone does not identify Santa Cruz. No reverse geocoding or world place polygons are added. Explicit coordinate-radius requests use Haversine distance; arbitrary named-place GPS comparison remains unknown.
- Mutually inconsistent positive source claims go to conflicts; do not pick an automatic winner.

Calendar month/day predicates compare FileSystem.ShootingTimeString using existing capture-time semantics; explicit offset/instant queries use FileSystem.ShootingTimeStamp when available. Do not convert through host time zone. Missing/invalid values are unknown. Evidence says “Library shooting time”; show a help note that the application's timeline may use filesystem fallback when source capture time is absent. The current schema does not preserve a reliable provenance flag, so do not invent one, infer provenance from equal dates, or claim independent EXIF verification. No extra capture-time re-probe or schema change is added.

Continue expands local candidates without uploads. Only a separate explicit approved cloud-analysis continuation verifies selected media. After 600 candidates, an explicit “Expand candidates” continuation raises each lane depth by 200 and total cap by 600, up to scope size, excluding already assessed MediaIds. No automatic query reformulation. Interrupted results remain labelled partial. Do not claim completeness even after candidate exhaustion; sampled pixels and ranking/model errors remain.

## 5. Storage and freshness

Use no vector DB or ANN. Main orchestrates; a worker_threads worker sequentially reads float32 vector shards and computes dot products on normalized vectors. Shards contain at most 4,096 vectors: 8 MiB at visual 512D, 6 MiB at metadata 384D. Keep at most two shards in memory plus bounded candidate heaps. Do not send full vectors to Vue.

Library paths, created through shared library-core helpers:
- agent/index/current.json: atomically published manifest pointer, schemaVersion 1.
- agent/index/generations/<uuid>/manifest.json: strict profile IDs, preprocessing/sampling/projection versions, generation ID, counts and artifact SHA256 checksums.
- agent/index/generations/<uuid>/visual-*.f32 and text-*.f32.
- agent/index/generations/<uuid>/rows.jsonl: row index/shard, lane, MediaId mapping, source hash, text-group/chunk/source-span or frame timestamp, input fingerprint and completion status.
- agent/index/build.json: strict resumable job with task keys/profile fingerprints and per-media completion/failure counts; no user query or conversation.
- agent/index/staging/<job-id>/: completed uncommitted shards/checkpoints.
- temp/agent/: derivative JPEGs, cleared on terminal run and next library open after transaction recovery.

Only validated complete shards are reusable. Checkpoint after each embedding batch; publish completed generations at 256 new vectors or job stop/completion. A manifest may intentionally represent partial library coverage; every referenced artifact is structurally complete and verified. Corrupt artifact invalidates its generation, not partially loaded rows. It never invalidates authoritative metadata.

Reuse unchanged immutable shards by same-volume hard links when creating a generation; if unsupported, copy and check disk space before writing. Never use symbolic links. Keep the prior generation until all readers release it, then delete it; preserve staged job progress until resumed or explicitly cleared. Disk reserve: 512 MiB plus predicted new vector bytes and copied artifacts; pause when unavailable.

Every search recomputes metadata projection fingerprints from current data, excluding stale rows. Registry edits invalidate dependent text through reverse UUID/ancestor dependencies. Exact/lexical metadata becomes effective immediately after commit. Save/open never calls an embedding provider. Pending text refresh occurs only before an explicit semantic search or explicit index update. New visual items are built only through index management.

Model/revision/dimension/preprocessing changes rebuild their affected space. Hash unchanged input text to reuse text embeddings across matching projections. A media metadata edit does not invalidate pixels. Removed records never return even if obsolete vectors remain in a retained generation.

Index build processes all metadata tasks then visual tasks in ascending MediaId order, with separate resumable cursors to avoid repeatedly loading different encoders. Index build is explicit, foreground, cancellable and resumable after restart. On reopen validate fingerprints before reusing tasks; no automatic continuation or upload. Clear/rebuild index never deletes operation receipts. Index/cache files are excluded from core backups; receipts are included as described in architecture.md.

Local/remote boundary: registry matching, exact checks, metadata-supported classification and result explanation are host-local in ordinary search. Unstructured semantic claims remain labelled candidates until explicitly analyzed; do not use a cloud call to classify hidden text implicitly. Local index refresh has no remote monetary budget.
