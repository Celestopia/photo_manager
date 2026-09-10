# Ordered Implementation and Release Gates

Status: implementation and acceptance in progress. Part of the [agent design](README.md); current behavior and recorded evidence are in the [runtime reference](../reference/agent-support.md).

The models, algorithms and UI are selected. The following stages define acceptance requirements; a passing build alone does not complete them.

## Stage 1: service configuration and contracts

Implement provider YAML templates/strict parsing, chat adapter and local encoders, redacted status, Open config/Reload/Test controls and budget accounting. Use the fixed Qwen models in providers.md. Implement synthetic capability fixtures and local fake servers. No library upload in ordinary CI.

Exit: real Beijing account passes text chat, streamed tool call, image Q&A, selected-media image tests; local CPU text/document and image/text embedding tests pass with network disabled; user-configured local fake contract passes the same transport cases. Missing keys, wrong region, wrong dimensions, unsupported tools, partial SSE, retries, cancelled and uncertain-billing requests have typed outcomes. No silent provider fallback.

Real-provider tests require an explicitly chosen test library and a manual opt-in environment flag; use synthetic/publicly permitted fixtures. A failed model capability blocks release and must be fixed against the selected contract, not replaced automatically.

## Stage 2: safe write foundation

Implement strict agent schemas, scope/epoch checks, shared write coordinator, expected-state full-draft saves, receipt transactions, undo and backup extension. Route manual/registry/library-info writes through the same coordinator. Add operation-history dialog.

Exit: fault-injection covers backup failure and every transaction replacement/recovery boundary; duplicate Apply/Undo returns one durable operation; stale/removed/invalid accepted targets reject atomically; later unrelated edits survive undo. Lost IPC result and restart recover the committed receipt. Test mixed manual-agent save provenance and receipt expiry. No embedding call in a metadata commit.

## Stage 3: viewer Q&A and review

Implement context lifecycle, full-frame/video assets, tool routing, viewer tab/composer/evidence, proposal review and sticky draft-save strip. Use existing picker components.

Exit: Q&A uses actual media; hidden/other metadata accessible through paging; read-only fields cannot be proposed or saved through the agent path. Save/discard/conflict/navigation work with existing manual controls. Typing/IME/fullscreen does not activate unrelated shortcuts. Old-media output cannot attach to a new selection.

## Stage 4: index infrastructure

Implement projections/chunks, frame formula, pinned local artifact validation, float32 shards, manifest checksums, resumable task queue, foreground manager and source invalidation. No DB/ANN dependency.

Exit: orientation/transparency/extreme aspect/GIF/short and 30-minute videos tested; reported sample timestamps span full duration. Failed inputs are not placeholder vectors. Rename/duplicate hashes retain correct MediaId membership; registry descendants invalidate affected text; stale text is excluded; Save/open never uploads. Resume retains complete tasks after cancellation/crash and checks fingerprints. Corrupt generation is rejected independently of core metadata.

## Stage 5: retrieval and batch workflow

Implement query parser, exact predicates, BM25/fusion/verification, five result groups, scope controls, continuation, gallery restoration and result-to-batch handoff. Implement per-item batch analysis, 100-item windows/500-item review ceiling and atomic selected Apply.

Exit: all representative product queries function with sparse metadata. Known mismatches excluded; unknown and conflicting evidence grouped correctly; named places never inferred from GPS without a supported comparison; biographies never become media assertions. Exact conditions and “prefer” remain distinct. Batch analysis never commits automatically.

## Stage 6: acceptance, packaging and documentation

Run ordinary repository checks: npm test, npm run build:renderer, git diff --check and node --check for changed CommonJS. Run verify-metadata only with --library pointing at an explicit test library. Smoke-test the packaged Windows application with no Python/GPU/model runtime installed. Update implemented PROJECT.md, configuration examples and user-facing README for optional uploads, agent language, settings/index/history, strict receipt persistence and retained core schema.

Release quality gate:
- A versioned labelled fixture of at least 200 media and 40 queries: 20 Chinese/20 English, including sparse metadata, exact dates/locations, contradiction/unknown cases, duplicate pixels, people/album context and 30-minute clips.
- Measure/report unique-media recall@200; no numerical semantic-quality release gate for this MVP.
- Measure/report precision separately for local candidates and explicitly verified items. Deterministic scope/UUID/date and upload-boundary tests must pass 100%.
- No confirmed factual claim based on invalid asset IDs, invented registry IDs or ignored strict contradictions.
- Track video brief-event misses explicitly; do not count unsampled evidence as verified absence.

Scale gate on Windows x64, 4 logical CPU cores, 16 GiB RAM and SSD:
- Synthetic 10,000-photo case (10,000 visual 512D +20,000 metadata 384D vectors assuming two text chunks/item), exact scan p95 <=3 seconds excluding network.
- Mixed 8,000 photos +2,000 30-minute videos (268,000 vectors with two text chunks/item), p95 <=15 seconds excluding network.
- Worst 10,000 long-video case is a streaming-memory correctness test, not a 15-second latency promise.
- Additional agent working memory <=1.5 GiB beyond the loaded app/library during local inference for these bounded test cases; worker shard buffers <=32 MiB.
- Gallery stays responsive enough to Stop within 250 ms; child processes terminate within 2 seconds after cancellation request, excluding committed filesystem transaction completion.

These are release targets, not measured results. If they fail, optimize the selected worker/batching/implementation and rerun. A material algorithm/model change requires explicitly revising the final specification and reporting the changed consequences; it must not appear as a hidden optimization.

Validate local documentation links, headings, fences, whitespace and cross-file decision consistency alongside the implementation checks.

Local-model acceptance: test pinned quantized models on CPU in the packaged Electron utility process; verify 512D/384D normalization, MiniLM token chunking, full-frame CLIP padding, native DLL packaging, installation checksum failure and offline import. Model downloads contain no library payload. With network denied, full indexing and local-query search work. Capture every remote payload in fake-provider tests: query planning contains only user text/schema; ordinary search never attaches candidates or stored metadata; selected cloud tools cannot access unapproved media/groups. Replace cloud-level quality ambitions with reported MVP measurements, retaining strict correctness and no-upload gates.
