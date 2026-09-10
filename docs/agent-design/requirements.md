# Product Contract

Status: planned implementation. Part of the [agent design](README.md); current application behavior is in the [implemented reference](../../PROJECT.md).

Final implementation scope. Concrete technical values live in the linked owning documents.

## Workflows

1. Viewer Q&A about the current photo/video, with current saved metadata and image/frame evidence.
2. Viewer proposals for title, description and tags, reviewed into the existing editor draft and explicitly saved.
3. Gallery batch proposals over a frozen selection, reviewed per item and committed atomically for the accepted subset.
4. Gallery natural-language retrieval combining visual vectors, descriptive metadata vectors and structured facts.

All metadata is tool-readable, including hidden description, people, GPS, location detail and technical fields. Initial context is compact; subsequent tools page through additional fields. Selected cloud runs require an explicit Send action, with a visible selection chip and optional attachment/group inspection in Options; no recurring confirmation or library-wide upload consent is inferred. The agent defaults to saved facts; an explicit “Include unsaved changes” switch includes a labelled draft snapshot.

Only title, description and existing tag membership are writable by the agent. No people/location/album/rating/privacy/hidden-description/technical writes, registry creation/rename/deletion, file mutation or organizational moves. Unspecified tag assignment adds existing tags, preserving membership. Removing/replacing tags or clearing/replacing nonempty text must be visible in the requested operation and review; when not requested, propose additions or unchanged values. Agent-generated titles are at most 512 Unicode code points and descriptions at most 8,000; these are proposal limits, not changes to the core schema or restrictions on manual metadata.

Batch selection can contain up to the target library size of 10,000 items. Analyze at most 100 new items per continuation window. Retain at most 500 analyzed items in an unresolved proposal; apply/discard that proposal before processing more. One reviewed commit contains at most 500 selected changed items. No automatic commits between analysis windows.

## Search semantics

No completeness prerequisite. Media with empty titles/descriptions/tags remain eligible through pixels. All available descriptive metadata participates in indexing. Known facts remain available even when embedding services fail.

Default scope is the complete current gallery query, including manual search and privacy filters, not merely loaded cards. “Entire library” explicitly removes those gallery restrictions for that search. The UI displays this change. Result-to-batch handoff requires explicit selection and a separate edit request.

Ordinary location/date requests prioritize supported matches, separate unknown facts and exclude established mismatches. Explicit “only” and exclusions are strict; unknown facts cannot satisfy them. “Prefer” changes ranking only. Conflicting source claims have a separate group and never count as confirmed. Metadata supporting a scene with inconclusive pixels remains a lower-ranked metadata-supported result. Missing evidence is not a contradiction.

Person/location identity must resolve to current UUIDs or an explicit unstructured claim. Ambiguous registered names produce an in-run choice. An unregistered place name can match descriptive claims, but cannot become an invented registry ID or a verified coordinate boundary. No geocoder or face-recognition feature is added.

Search is ranked and bounded, not exhaustive. Report candidate, inspection, indexing, truncation and failure coverage. Support explicit continuation. The full evidence and ranking contract is in [retrieval.md](retrieval.md).

## Media and lifetime

Support current application formats. Video visual analysis supports durations through 1,800 seconds. Longer videos remain tool-readable and metadata-searchable but show “Visual analysis duration limit exceeded”; no automatic first-30-minute indexing. Audio/transcription, native temporal embeddings and whole-video uploads are excluded. Animated GIF behavior is specified in retrieval.md.

Chats, prompts, responses, result sets and review proposals exist only in bounded memory for the current open-library session. Completed state survives navigating to another media and back. No transcript export, persistent summaries or restart chat resumption. Library close/app exit clears it. Temporary bytes are cleaned as specified in architecture.md.

Edit receipts are a separate durable feature, with a 30-day undo window. Indexes and index-build checkpoints persist. Their persistence does not preserve conversations.

## Application boundaries

Keep one window and one active local library, strict schema 4, authoritative JSONL, UUID references, MediaId identity, library locking and recoverable transactions. No database, cloud synchronization, watcher or local-server management. Add explicit local embedding-model download/import as specified in local-embeddings.md.

All controls are English under current AGENTS.md. Replies follow the user language and preserve Unicode metadata. Use the current light-blue theme. Record local model installation and explicitly selected cloud processing in implemented PROJECT.md.

Settings, index management, usage display and persistent undo history are required parts of this feature, not optional follow-up projects. Their designs are fixed in [ui.md](ui.md).

Local embeddings use CLIP 512D and multilingual MiniLM 384D, including private descriptive metadata. Ordinary search returns local candidates without automatic cloud verification or cloud result summaries. A cloud planner may see only the typed query; local query mode works offline after installation. Optional selected-media cloud Q&A/analysis uses the visible send boundary in [local-embeddings.md](local-embeddings.md). No persisted privacy schema is added.
