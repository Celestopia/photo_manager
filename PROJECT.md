# PhotoManager Project Specification

This root file and the linked files under docs/reference together form the implementation-level source of truth. They record current architecture, persisted data contracts, lifecycle rules and interactions. Read the owning reference and nearby code/tests before editing. If code and documentation disagree, resolve the mismatch rather than introducing another set of rules.

The agent design under docs/agent-design is the permanent target specification. Native agent implementation is in progress; the [agent runtime reference](docs/reference/agent-support.md) distinguishes working behavior from unverified release gates.

## Product Scope

PhotoManager is a local Windows desktop media manager for user-selected, independent libraries. A library may be any ordinary directory on the computer and does not need to be inside the project directory.

Current capabilities include:

- Managing images and videos on one timeline.
- Viewing images, playing videos, and editing shared customization fields.
- Filtering by media type, rating, privacy level, album, tag, person, and hierarchical location.
- Batch-setting titles, ratings, privacy levels, albums, tags, people, and primary locations across mixed images and videos.
- Managing tags, albums, people, and locations through registries, while preventing metadata from referencing unregistered values.
- Keeping metadata, registries, thumbnails, logs, and backups separate for every library.
- Running initialization, incremental updates, integrity verification, thumbnail generation, and CSV export inside the application.

The project is local-first. Core browsing, management, indexing and local-query retrieval do not depend on cloud services. Optional chat and selected visual analysis send only explicitly selected content to the configured provider; query planning sends only the typed query. No database is used. JSONL remains the source of truth.

The application interface is English-only; there is no localization layer or language selector. User-authored library names, titles, descriptions, registry values, paths, and other metadata remain unrestricted Unicode and are displayed exactly as stored. UI sorting and search use English (`en-US`) collation, and viewer timestamps use the fixed 24-hour `YYYY-MM-DD HH:mm:ss` format.

## Detailed implemented reference

| Reference | Owns |
| --- | --- |
| [Runtime Architecture](docs/reference/architecture.md) | Platform and packaging, Electron/preload contracts, source ownership and dependency direction. |
| [Configuration and Data Locations](docs/reference/configuration.md) | Roaming configuration, machine-local state and the library directory layout. |
| [Library Lifecycle and Persistence](docs/reference/library-lifecycle.md) | Library identity and boundaries, opening/initialization, locking, backups and transaction recovery. |
| [Media and Registry Data Model](docs/reference/data-model.md) | Strict media schemas, capture-time semantics, UUID registries and location relationships. |
| [Media Processing and Playback](docs/reference/media-pipeline.md) | Scanning, incremental reuse, thumbnails, live playback and temporary transforms. |
| [Interface and Editing](docs/reference/interface.md) | Gallery filtering, viewer drafts, shared location selectors and registry management. |
| [Maintenance and Acceptance](docs/reference/maintenance-and-testing.md) | Application/CLI maintenance, required tests and Windows packaging acceptance. |
| [Native Agent Runtime](docs/reference/agent-support.md) | Local models/indexing, selected-content sends, reviewed proposals, receipts and current validation status. |

## Native agent implementation

Start with the [agent runtime reference](docs/reference/agent-support.md), [target design](docs/agent-design/README.md) and [user-visible consequences](docs/agent-design/consequences.md). The working implementation includes local CLIP photo/frame embeddings, local multilingual metadata embeddings, assistant panels, explicit model downloads, selected-media Q&A/proposals and durable conditional undo. Full design acceptance is still in progress.

Library indexing remains local and no database is added. Model assets total 291,244,406 bytes (about 278 MiB); the CPU native runtime is packaged separately with the application. Cloud content is sent only through the explicit selected-content Send action; optional context inspection is available from composer Options. See the full [documentation index](docs/README.md).

## Development Invariants

1. Do not restore project-level library/data/log paths or configurable internal filenames.
2. Never write library-owned data outside its root.
3. Renderer never accesses the filesystem directly.
4. Media never store unregistered album/tag/person/location references or registry display text.
5. `Location.Detail` is neither registry data nor a location filter.
6. Derive children from `ParentId`; reject cycles.
7. Maintenance never guesses a missing `--library` path.
8. Never skip corrupt JSONL lines and continue opening.
9. Global deletion must use a recoverable transaction; backup failure blocks writes.
10. Probe failure does not remove customization access.
11. Do not rehash/reprobe unchanged large videos.
12. Media/library changes must clear old sound, menus, transforms, and library-scoped recents.
13. Use `MediaId`, not `FilePath` or hash, for media state, IPC, and relationships.
14. All entity IDs are lowercase UUID v4 and globally unique across media and registries.

## Explicitly Out of Scope

- Database, cloud sync, multi-user or cross-process collaborative editing.
- Recent-library lists, nested libraries, symlink media, or external media references.
- Automatic filesystem monitoring.
- Album detail pages/covers or photo-group structures.
- Video proxy transcoding, subtitles, chapters, track switching, manual covers, remembered position, looping, screenshots, or exact variable-frame-rate indexing.
- In-application backup restoration.

## Architecture Summary

PhotoManager combines application code and global settings with user-selected independent libraries whose management data are self-contained. The Electron main process owns the only active library session and all writes; maintenance tools share its boundary, lock, and persistence modules; Vue owns interaction and serializable UI state. A library can be moved or backed up together with `.photo_manager` and has no dependency on data paths inside the installation directory.

## Documentation maintenance

- Keep implementation details in the owning docs/reference file and this root focused on scope, invariants and navigation. Do not duplicate full contracts across files.
- Keep planned decisions in docs/agent-design, with explicit implementation status. Update the relevant implemented reference and design status together as each feature ships.
- Treat docs as maintained repository content, reviewed alongside related changes. Model caches, credentials, library data and generated reports do not belong there.
- Validate relative file links and heading anchors after reorganizing documentation.
