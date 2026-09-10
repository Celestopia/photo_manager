# Implementation Architecture

Status: planned implementation. Part of the [agent design](README.md); current application behavior is in the [implemented reference](../../PROJECT.md).

This document specifies new implementation work. Record these modules in the owning implemented reference when delivered; this planned module map does not describe existing source files.

## Module ownership

| Module | Responsibility |
| --- | --- |
| src/main/agent/agent-service.js | One foreground workflow, contexts, immutable run snapshots, orchestration |
| src/main/agent/provider-config.js | Strict YAML parsing, role resolution, reload, redacted status |
| src/main/agent/providers/chat-completions.js | Streaming/nonstreaming chat transport, tool deltas, image content |
| src/main/agent/local-embedding-service.js | CPU utility-process encoder, local artifacts and validated 512D/384D vectors |
| src/main/agent/model-assets.js | Explicit download/import, checksums, Local AppData model paths |
| src/main/agent/budget.js | Reservations, counters, deadlines, continuation |
| src/main/agent/tool-router.js | Mode allowlists, strict tool schema validation, scope enforcement |
| src/main/agent/media-assets.js | MediaId resolution, Sharp/FFmpeg derivatives and timestamped assets |
| src/main/agent/index-service.js | Generation manifests, task reuse, index builds, freshness |
| src/main/agent/vector-worker.js | Shard reads and exact cosine search in worker_threads |
| src/main/agent/metadata-projection.js | Pure deterministic text projection, chunks and fingerprints |
| src/main/agent/retrieval-domain.js | Pure query validation, BM25, fusion, facet/group membership |
| src/main/agent/retrieval-service.js | Scoped retrieval, verification, evidence and continuation queues |
| src/main/agent/proposal-service.js | Immutable proposal versions, review patches and expected state |
| src/main/agent/operation-store.js | Receipt queries, idempotency, inverse changes, expiry |
| src/main/library-write-coordinator.js | Serialize all application writes and lifecycle barriers |
| src/shared/agent-schema.js | IPC/tool/query/proposal/receipt strict discriminated schemas |
| src/renderer/composables/use-agent-session.js | Renderer session state, run events, disposal |
| src/renderer/domain/agent-review.mjs | Pure three-way merge/display calculations |
| src/renderer/components/agent/*.vue | Shell, composer, evidence, proposal, settings/index/history dialogs |

Existing application composition coordinates use-agent-session and use-media-editor via injected callbacks; composables do not import one another or duplicate registry state. Reuse existing shared controls and feedback service. main.js remains composition only. Wire through current ipc-handlers/preload allowlists.

Use built-in fetch, AbortController, worker_threads and current js-yaml/Sharp/FFmpeg. Add @huggingface/transformers 3.7.2 and its CPU ONNX Runtime dependency, packaged outside ASAR. Local models run in an Electron utility process. No LangChain, database, Python or CUDA. The new model/runtime dependency and explicit model downloader are documented in local-embeddings.md.

## Context and preload contract

Main-generated context includes approvedCloudMediaIds and approvedMetadataGroups only after explicit Send selected. Enforce this before materializing any remote payload; tool requests cannot enlarge it. Cloud query planning has no library-tool access and returns a plan only. Ordinary retrieval results are assembled locally.

Main-generated context:
libraryId, epoch UUID generated on every library open, contextId, mode (viewer/search/batch/index), frozen target MediaIds or gallery query, configFingerprint, runId, sourceTokens and budgetWindow.

Source token is SHA256 of canonical current authoritative record plus relevant referenced registry definitions; it is not a persisted revision field. Model-supplied IDs never grant authority.

Preload agent namespace exposes:
- createContext({mode,mediaId?,selectionIds?,scope?}) -> contextId and initial redacted snapshot.
- startTurn({contextId,text,includeDraft,draftSnapshot?}) -> runId.
- cancelRun({contextId,runId}).
- continueRun({contextId,runId,action}) where action is continue/reducedCoverage/expandCandidates.
- getSnapshot({contextId}), clearContext({contextId}), disposeContext({contextId}).
- reviseProposal({proposalId,version,reviewEdits}) -> new immutable version.
- prepareViewerMerge({proposalId,version,acceptedFields,currentDraft}) -> validated merge/conflicts; no disk write.
- applyBatch({proposalId,version,acceptedChanges,operationId}).
- listOperations({cursor,limit}), previewUndo({operationId}), applyUndo({operationId,undoOperationId,expectedPreviewToken}).
- getProviderStatus(), openProviderConfig(), reloadProviderConfig(), testProviders().
- getModelStatus(), downloadModels(), importModelFolder(), cancelModelDownload(); all use fixed manifests and main-controlled paths.
- getIndexStatus(), startIndexJob({scope,kind}), resumeIndexJob(), clearIndex({expectedGenerationId}).
- onEvent(listener) -> unsubscribe.

Limit user message to 16,000 code points, selection to 10,000 unique UUIDs, list pages to 100, accepted proposal to 500 items/8 MiB. Methods reject unknown keys, wrong types, stale epoch and unavailable library. Only the active renderer webContents sender is accepted.

Events carry libraryId/epoch/contextId/runId, monotonically increasing sequence, type and payload. Types: text, tool, progress, proposal, results, usage, paused, completed, cancelled, error. Subscribe before start; recover gaps with snapshots; ignore stale epochs. Coalesce text deltas every 50 ms, max 16 KiB per event, snapshot pages <=1 MiB. Asset base64 and secrets never appear in event payloads.

State transitions: idle -> preparing -> running -> paused or review or completed; any precommit active state -> cancelled/error. Review -> applying -> completed/conflict/error. Continue starts a new budget window from paused. Applying cannot be cancelled mid-transaction. Host publishes results and coverage from its own state.

## Model tools

All schemas reject additional properties. Tool output is structured evidence, not instructions. The search tool rows below are local host operations, not tools exposed to the cloud query planner. Optional cloud analysis uses a separate viewer/batch-style context restricted to approved selected IDs and metadata groups.

| Tool | Arguments / bound | Modes |
| --- | --- | --- |
| get_media_metadata | mediaIds <=20, fieldGroups enum, text offset/limit <=4000 code points | viewer/batch/search |
| search_registries | kind, query <=256 chars, cursor, limit <=50 | all conversational modes |
| query_media | validated predicate tree, cursor, limit <=100 | search; viewer/batch restricted to own targets |
| search_media_semantic | validated query-plan object | search |
| inspect_image | mediaId, optional normalized crop rectangle; max 2 crops | viewer/batch/search |
| inspect_video | mediaId, requested interval within duration; host samples/caps | viewer/batch/search |
| propose_metadata_changes | per-item title/description/tag operations, source citations; <=20 items/call | viewer/batch |
| publish_search_results | evidence IDs generated by retrieval service, <=100 IDs/call | search |
| submit_verdict | per-facet enum and valid source citations for exactly one media | internal verifier only |

The host's retrieval pipeline determines candidate membership, counts and groups. publish_search_results cannot invent IDs or promote evidence. Model may request tools, not choose an HTTP destination or filesystem path. No shell/code/SQL/browser or commit tool.

Tag operations are mutually exclusive add/remove or replace. Omitted fields unchanged; empty title/description explicitly clears; empty tag replacement clears. Validate current UUIDs and existing core customization rules. Implicit tagging defaults to add. Generated text limits are in requirements.md. Reject unsupported edits instead of silently filtering fields.

## Editing and shared write coordination

Route existing manual metadata, manual batch, registry and library-info mutations through the same write coordinator. These correctness changes are prerequisites, not optional agent-only wrappers. Maintenance and library close acquire a lifecycle barrier. Never hold the coordinator while waiting for network/user review.

At proposal creation capture saved base record/registry tokens and, for viewer merge, the renderer draft snapshot. Store canonical proposals only in main. Review revisions get a new version and hash; the renderer cannot mutate the accepted canonical body indirectly.

Viewer:
1. Compare base draft/current draft/proposed field. Merge unchanged fields, retain unrelated edits, present same-field conflicts.
2. Accepted agent fields enter existing draft. Track provenance until save/discard.
3. Extend existing full-draft save payload with expectedSourceToken and optional accepted proposal reference. Existing manual save obtains the same expected token.
4. Main rechecks current state, fields, proposal/epoch and all references. A stale draft is rejected with current values; do not overwrite the whole record from an old draft.
5. Save manual and accepted agent changes together. Receipt records only agent-attributed fields whose actual final values match the accepted proposal; subsequent manual modification removes that field's agent attribution.

Batch:
1. Review can select a subset of proposed fields/items; resolve failures/conflicts first.
2. Acquire coordinator and validate every accepted target/base token and registry reference again.
3. Any missing/stale/invalid accepted item blocks the whole commit. Do not silently skip.
4. Build copied replacements; create required pre-change backup.
5. Commit authoritative metadata and receipt together with scripts/library-transaction.js commitTextTransaction.
6. Only after durable success publish in-memory records and one change notification, invalidate affected text fingerprints, and return receipt.

If backup fails, do not write. Transaction failure follows existing rollback/recovery; never claim partial success. Core schema remains 4 and no per-record revisions are added. Extend shared library-core paths and transaction target validation for agent receipts explicitly, not arbitrary paths.

## Durable receipts and undo

Store schemaVersion 1 immutable JSON receipts at .photo_manager/agent/operations/<operationId>.json. Required content: libraryId, operationId, operation kind, UTC createdAt/expiresAt, proposal/version/hash or undoneOperationId, provider/model identifiers for agent provenance, and per-MediaId/field before/after values. No prompts, responses, hidden unedited metadata or image data. Empty/no-change saves create no agent receipt.

OperationId is a host-issued UUID, registered with its canonical payload hash. Repeating committed ID+hash returns original result; another hash fails. The receipt and metadata participate in the same transaction so a lost response can be reconciled after recovery. A proposal cannot be replayed across an epoch/restart. Batch retry before recovery completes is blocked.

Undo is all-or-nothing for the original receipt's affected fields. Preview validates every field still equals recorded after-value, media exists and restored UUIDs remain valid. Apply revalidates the preview token under coordinator, creates a backup, and writes the inverse plus its own immutable receipt. Preserve later unrelated fields. Original operation is marked undone by deriving from inverse receipts; do not mutate it. Redo is not included; undo receipts are not themselves offered as undoable. Retain an inverse receipt at least until the original expiry to prevent duplicate inverse operations.

Default expiry: createdAt +30 days; config range 1–365 for new receipts, no retroactive shortening. Prune expired records only on explicit library open cleanup or after a settled commit under the coordinator, after transaction recovery, never during active undo. No silent count cap. On receipt corruption, disable that operation with an error; metadata remains usable after authoritative recovery.

Backups include all currently retained receipts, adding SchemaVersion: 1 and an exact AgentOperations array of relative receipt paths/checksums to newly created backup manifests. Do not add an old-snapshot compatibility parser or rewrite old snapshots. Since the application has no general automatic backup restore flow, this work does not add one. Restore tooling must restore metadata and corresponding receipt set together and validate the recorded manifest version. Existing old snapshots remain untouched. Daily backup reuse requires a complete new manifest; an old daily snapshot does not suppress the first new-format backup. Index generations and provider configuration are excluded.

## Lifecycle and resource cleanup

One foreground workflow per open library, with bounded HTTP/extraction concurrency from providers.md. Batch/search/index blocks competing gallery mutations/navigation/maintenance. Stop cancels network, terminates extraction and worker iteration, settles known outputs, and leaves results/coverage truthful.

Leaving viewer media cancels its active run; completed session context remains keyed by MediaId. Closing a panel in the same workflow hides it but shows a run strip. Switching library/maintenance invalidates epoch and contexts, drains active durable transactions before releasing the exclusive library lock. Cancellation cannot interrupt a transaction between replacements.

Session state is main-owned, bounded as ui.md specifies; renderer keeps only display snapshots. On exit/close, wipe in-memory chats/results/proposals and remove temp/agent assets after handles close. Crash leftovers are cleaned on the next library open after recovery; no claim of secure erasure. Derivatives are not reused as persistent photo caches.

Index resume persists task fingerprints, not conversation state. Reopen validates source/model identity. Metadata open/save never triggers network traffic. Source changes still use explicit Update Metadata; no filesystem watcher.

Clean listeners, event subscriptions, timers, streams, AbortControllers, worker handles and media assets idempotently. Streaming/tool errors are sanitized. HTTP failures do not affect normal gallery browsing or rollback previously valid metadata edits.

The model-download process may access only allowlisted artifact URLs. The embedding utility process uses local files only and never falls back to hosted inference. Include encoder sessions and download handles in cleanup; terminate a stuck utility process on cancellation. Target up to 1.5 GiB additional peak memory during local inference, with one active encoder; this is a packaging/test budget, not a measured guarantee. Library index shards remain separately bounded.
