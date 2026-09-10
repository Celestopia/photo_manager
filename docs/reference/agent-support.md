# Native Agent Runtime

Implementation status: in progress. The working tree contains the runtime and UI described here; the full design's release gates have not all been completed. The maintained target design is in [agent-design](../agent-design/README.md).

## User-visible behavior

The gallery and viewer expose a conversation-first Assistant sidebar with a scrollable transcript, bottom composer, Options button and Send/Stop action. Enter sends; Shift+Enter inserts a newline; IME composition does not send. Suggestions fill the composer without sending. The context chip identifies the current item or selection. Technical provider/index/budget/history controls live in the separate Assistant settings dialog, opened from Options. Shared context defaults remain basic information only; location, people, private notes and technical details remain opt-in. Natural-language edit requests produce review cards without an edit-mode checkbox. Gallery search supports the current gallery filters or the entire active library. Local query mode uses English visual text without a provider request. The optional query planner sends only the typed request and a generic predicate schema; it receives no library records, registry dictionaries, candidates or pixels.

Local retrieval combines CLIP image/frame vectors, multilingual descriptive/contextual metadata vectors, BM25 and exact predicates. Metadata completeness is not required. Missing or stale descriptive vectors are refreshed locally before search; visual indexing remains explicit. Results distinguish exact matches, metadata-supported candidates, unknown facts, conflicting evidence and unverified visual candidates. Expanding candidates reuses the original interpreted query and frozen MediaId scope with greater local ranking depth. Changed scope metadata requires a new search; expansion does not upload media or repeat query planning.

Selected candidates can be sent for visual verification or metadata proposals. Send is one action: the host captures the selected filenames, provider and enabled metadata groups before dispatch. The composer Options menu offers optional shared-context inspection. Existing-tag lookup is available automatically for tagging requests; the model is instructed not to look up the catalogue for unrelated questions. Metadata read tools cannot expand these groups or access another media record. Media descriptions and registry descriptions are treated as evidence, not executable instructions. People are read-only and no face identification is implemented.

Only Title, Description and existing TagIds can be proposed. Tag proposals add to existing assignments unless the user explicitly enables replacement/removal. Review allows editing proposed text and selecting proposed tags. Each revision creates a new main-owned proposal identity after validating its source and field set. Viewer acceptance merges selected fields into the existing draft; replacing an overlapping manual value requires the explicit per-field override checkbox. Discarding or replacing the draft releases accepted proposals. The existing Save operation persists all draft changes; its receipt records only accepted agent fields whose final values still match the accepted proposal. Gallery Apply can commit all reviewed fields in one atomic transaction; conflicting proposals for the same media/field reject the batch. Neither a chat response nor a tool call saves metadata automatically.

Edit history expands into before/after values before Undo can be chosen. Completed selected-verification results appear incrementally and survive cancellation; Continue targets only unfinished selections. Larger selections are divided into separately initiated Send/Continue windows of 100 media for chat/edit or 40 for verification. Unsent items remain queued. Displayed chat output retains at most 100 entries or 16 MiB, with a visible notice when older output is cleared; pending proposals are retained. Streamed text updates are coalesced at 50 ms and incomplete output is labelled.

## Providers and local models

Assistant replies, including streamed partial replies, render Markdown through `AgentMarkdown.vue` and the pure `agent-markdown.mjs` renderer. Headings, emphasis, lists, tables, quotes and code are supported. Raw HTML is escaped; generated image references render as text, and links are inert text with destination tooltips. Rendering a reply never fetches model-generated assets or navigates the application. User messages remain plain text.

`%LOCALAPPDATA%/PhotoManager/app-data/agent-providers.yml` owns role selection, base URL, API key or environment-variable name, model name/revision and transport capabilities. Unknown configuration fields are rejected. Status never returns keys. The default Qwen endpoint contains a workspace placeholder that must be configured. Settings offers Open configuration, Reload and an explicitly initiated synthetic-image/tool capability test.

The embedding models are immutable local profiles:

Generic budgets, estimated prices and receipt retention belong to the `agent` section of roaming `%APPDATA%/PhotoManager/app-data/config.yml`, following the application's configuration/storage boundary. Provider credentials remain machine-local. Settings opens each owning file and Reload reads both. Defaults are estimated CNY caps; the price-table values are scheduling assumptions, not provider price quotations. The complete new section is:

```yaml
agent:
  receiptRetentionDays: 30
  budgets:
    viewer: { seconds: 120, calls: 8, money: 1 }
    search: { seconds: 180, calls: 2, money: 0.1 }
    batch: { seconds: 300, calls: 120, money: 5 }
    verify: { seconds: 180, calls: 50, money: 2 }
  prices:
    inputPerMillion: 4
    outputPerMillion: 12
    currency: CNY
```

Retention accepts 1–365 days and applies to newly created receipts; existing receipt expiry timestamps remain unchanged. Per-window time/call/cost limits remain bounded. Image/frame and resource ceilings are not editable.

| Model | Revision | Output | Artifact bytes |
| --- | --- | --- | ---: |
| Xenova/clip-vit-base-patch32 | d15189d7028b43f1d3e65039190477f6af591c2a | 512D image and text | 155,851,918 |
| Xenova/paraphrase-multilingual-MiniLM-L12-v2 | 2c4055b12046f11709e9df2c122e59ffbdc2f900 | 384D metadata | 135,392,488 |

Total model assets are 291,244,406 bytes (about 278 MiB), separate from the application/native runtime. Download/import checks every pinned size and SHA256. Inference uses local files only, CPU ONNX, Transformers.js 3.7.2 and an Electron utility process. The Node maintenance commands use a worker thread. Sharp is overridden to the application's patched version throughout the dependency graph. No Python, GPU server, vector database or cloud embedding endpoint is used.

## Index persistence

Derived index files live only below `.photo_manager/agent/index/`:

- `current.json`: version and generation UUID, published atomically.
- `generations/<uuid>/manifest.json`: strict profile fingerprint, generation identity, shard descriptors/checksums, creation time and failed media/sample tasks.
- `generations/<uuid>/shard-N.f32`: little-endian normalized float32 vectors.
- `generations/<uuid>/shard-N.json`: the associated row array, with MediaId, lane, input fingerprint, part, frame time or text-token span and expected coverage.

A checkpoint publishes only structurally complete, checksummed shards. The build processes text before pixels, checkpoints at 256 vectors, and can reuse completed tasks after interruption. Search excludes stale projections and removed media. Registry display text is derived; UUIDs remain authoritative. Existing source size/mtime and SHA256 are checked before visual indexing. Changed sources require Update Metadata, not implicit metadata modification.

Frame sampling covers videos up to 30 minutes with at most 120 samples. Actual decoded timestamps are recorded; missing samples are reported. A missing frame never becomes a thumbnail or placeholder vector. Images use full-frame letterboxing. GIF samples follow animation timing. No audio or temporal model is added.

The application permits one foreground agent run. Metadata/registry writes and lifecycle transitions share the write coordinator. Closing a library cancels and drains agent work before releasing its lock. Index generations are disposable and are excluded from core backups. Successful builds prune obsolete generations while retaining the current and previous generation.

## Reviewed writes and undo

Source tokens hash the authoritative record plus its metadata projection. Full viewer saves reject stale tokens. Proposed tag definitions are also checked again at acceptance/save.

Receipts live at `.photo_manager/agent/operations/<operation-id>.json`. A receipt contains schemaVersion 1, operation/library IDs, creation/expiry timestamps, undo timestamp, and per-MediaId before/after values for the three agent-editable fields. Metadata, receipt and library manifest update commit in the shared recoverable transaction before memory publication. Apply and Undo are idempotent by operation identity.

Undo rejects the entire operation if any affected field no longer equals its recorded after-value, a media record is missing or an inverse registry reference is invalid. Unrelated later edits survive. Receipts expire after 30 days; expiry is processed after transaction recovery on library open. New backup manifests use SchemaVersion 1 and contain checksums for copied, unexpired agent receipts. Old backup snapshots are not rewritten or reused as receipt-aware daily snapshots.

## Ownership and diagnostics

Main owns sessions, provider snapshots, budgets, tool permission checks, proposals and receipts. `use-agent.js` owns renderer panel state and IPC subscriptions; `AgentPanel.vue` renders the conversation and composer; `AgentSettingsDialog.vue` owns the separate modal presentation. New chat clears selected-media model conversation history and displayed replies, retaining pending proposals with a notice. Editor integration passes callbacks through the application composition root. Preload exposes named agent methods only. Renderer processes never receive vectors, keys or filesystem access.

Standalone diagnostics require an explicit library and the shared exclusive lock:

```powershell
node scripts/agent-models.js --status
node scripts/agent-models.js --download
node scripts/agent-index.js --library "G:\Gallery_test"
node scripts/agent-index.js --library "G:\Gallery_test" --rebuild
node scripts/agent-search.js --library "G:\Gallery_test" --query "sea scenery"
```

The model commands are global and do not access a library. Close the test library in the desktop application before standalone index/search commands.

## Validation recorded during implementation

- CPU Node and Electron utility-process tests produced normalized 384D metadata and 512D image/query vectors from the pinned assets.
- A Windows unpacked package built successfully; inference also worked using its packaged ASAR and native ONNX dependencies.
- `G:\Gallery_test`: 558 authoritative media records, 1,123 metadata vectors and 917 visual vectors. Three requested video samples were unavailable and recorded as failures. No media were uploaded or authoritative metadata edited by indexing.
- A local “sea scenery” query took 1,775 ms including query embeddings and returned 381 unverified candidates. This is a single observed timing, not a recall measurement or a scale guarantee.
- Focused tests cover write serialization, failed backups, receipts/undo, stale review, predicate exclusion/preference, incomplete SSE tools, approved-group enforcement and mixed manual/agent draft provenance using a fake local VLM.
- Synthetic exact-scan benchmark, five runs after stricter row validation: 10,000 photos /30,000 vectors, 508–559 ms; 8,000 photos plus 2,000 long-video cases /268,000 vectors, 3,312–3,771 ms. No semantic-quality claim or statistically robust p95 follows from five synthetic runs.
- Read-only test-library verification passed: 558 checked, zero missing/extra/tampered/type-mismatch/probe/read/privacy errors.
- The current preprocessing/sampling generation resumed with zero new visual or text vectors; the same three unavailable video samples remain explicit failures. A real Electron local search rendered 362 candidates and opened a video in the viewer Assistant, with no page-level horizontal overflow. Agent IPC payloads are serialized before crossing the context bridge to remove Vue proxies.
- Current full suite: 127 passing tests. Review tests additionally cover one-use send approval, immutable user revisions, expired proposal identities and reviewed-value receipt provenance. Renderer workflow tests cover separately approved windows, partial verification, duplicate Apply suppression and plain IPC payloads, one-click scope capture and New chat retaining pending proposals. Renderer production build, CommonJS syntax checks and `git diff --check` pass.
- Live Qwen capability/quality testing and the labelled bilingual retrieval benchmark remain unverified. Credentials were not supplied for a live-provider test.

Remaining implementation/release work must be tracked against [validation](../agent-design/validation.md), not inferred complete from a successful build.

Current gaps against that target include agent-requested image crops/additional video inspection, structured evidence/facet presentation, bounded result/history paging and complete context snapshot recovery. The immutable index currently copies reusable validated rows into new checkpoint generations; hard-link shard reuse and shared computation for duplicate pixel hashes are not implemented. The full index fault-injection and labelled retrieval acceptance matrix also remains outstanding. These are implementation gaps, separate from the unavailable live-provider credentials.
