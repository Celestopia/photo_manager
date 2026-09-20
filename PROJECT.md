# PhotoManager Project Specification

This is the implementation-level specification for PhotoManager, intended for maintainers, reviewers, and future AI agents. It records the architecture, data contracts, interaction constraints, and failure-handling strategies implemented by the current code. If the code and this document disagree, first determine whether the difference is an incomplete migration or a defect; do not silently introduce a second set of rules.

This entry point and the linked references under `docs/reference` together form the implementation-level source of truth. Detailed contracts have one owning reference; update that reference when behavior changes.

## Product Scope

PhotoManager is a local Windows desktop media manager for user-selected, independent libraries. A library may be any ordinary directory on the computer and does not need to be inside the project directory.

Current capabilities include:

- Managing images and videos on one timeline.
- Opening multiple independent library windows by launching PhotoManager again, with one active library per window.
- Viewing images, playing videos, resizing or collapsing viewer-session side panels, and editing shared customization fields.
- Keeping viewer arrow navigation available after ordinary button clicks while preserving text editing, control adjustment, popup handling and video seeking shortcuts.
- Generating separate first-frame video viewer covers on demand, with aspect-preserving scaling and library-scoped cancellation (see Media Processing and Playback).
- Batch-generating video covers through gallery maintenance or the explicit-library CLI, with cache reuse and optional forced regeneration.
- Using shared first-frame extraction for video thumbnails and covers, with explicit thumbnail maintenance rebuilding outdated cache recipes.
- Displaying photos and video covers through one persistent image surface with stable library-scoped resource URLs, bounded adjacent preloading, and a decoded-frame handoff to video playback. Navigation retains the outgoing visual until the latest replacement decodes; see Shared Viewer Image Loading for transition and cleanup rules.
- Filtering by media type, rating, privacy level, album, tag, person, and hierarchical location.
- Retrieving whole media items through a central gallery Assistant using manually built local visual/description/context embeddings, temporary conversations, fixed result-count controls and relevance ordering intersected with ordinary gallery filters. There are no agent-generated predicates or registry lookup tools.
- Explorer-compatible copying of one viewer file or an ordered gallery selection through the Windows file clipboard.
- Permanent single-item and all-or-nothing batch media deletion with filesystem/metadata transaction recovery.
- Batch-setting titles, ratings, privacy levels, albums, tags, people, and primary locations across mixed images and videos.
- Managing tags, albums, people, and locations through registries, while preventing metadata from referencing unregistered values.
- Keeping metadata, registries, thumbnails, logs, and backups separate for every library.
- Running initialization, incremental updates, integrity verification, thumbnail generation, and CSV export inside the application.
- Chatting about explicitly selected viewer media and imported attachments, with persistent library-local conversations, local switchable image/GIF input previews, and provider-reported per-completion token usage, sequential tool calls, and human-reviewed title, description and existing-tag suggestions. Replies continue while Assistant is hidden behind Information. Media navigation prepares a fresh draft; only submitted conversations appear in History (see the viewer chat reference below).
- Optional conversation-scoped Tavily web search and page extraction, with saved source evidence, validated citations opening in the system browser, and separate reported search credits. Web tools share the sequential Assistant loop and cannot approve metadata changes.

The project is local-first. Core browsing and management do not depend on network services, and no database is used. Assistant sends only explicitly submitted conversation inputs to the configured remote API or local model server. Media and registries use JSONL; chat uses independent session JSON files.

The application interface is English-only; there is no localization layer or language selector. User-authored library names, titles, descriptions, registry values, paths, and other metadata remain unrestricted Unicode and are displayed exactly as stored. UI sorting and search use English (`en-US`) collation, and viewer timestamps use the fixed 24-hour `YYYY-MM-DD HH:mm:ss` format.

## Detailed References

| Reference | Owns |
| --- | --- |
| [Runtime Architecture](docs/reference/architecture.md) | Platform, Windows packaging, IPC contracts, source ownership and dependency boundaries. |
| [Configuration and Data Locations](docs/reference/configuration.md) | Roaming settings, machine-local state and the library directory layout. |
| [Library Lifecycle and Persistence](docs/reference/library-lifecycle.md) | Library identity, boundaries, startup, initialization, locking, backups and transaction recovery. |
| [Media and Registry Data Model](docs/reference/data-model.md) | Strict media fields, capture-time semantics, UUID registries and location relationships. |
| [Media Processing and Playback](docs/reference/media-pipeline.md) | Scanning, incremental reuse, thumbnails, video playback and temporary transforms. |
| [Gallery Retrieval Assistant](docs/reference/retrieval.md) | Model assets, manual index snapshots, video sampling, semantic ranking, temporary chat and lifecycle. |
| [Interface and Editing](docs/reference/interface.md) | Gallery queries, selection, viewer drafts, location hierarchy and registry management. |
| [Maintenance and Acceptance](docs/reference/maintenance-and-testing.md) | Library maintenance, explicit CLI commands, tests and Windows release checks. |

See the [documentation index](docs/README.md) for navigation and maintenance conventions.

The [viewer chat reference](docs/agent/README.md) documents the implemented Assistant, including independent sessions, attachments, image-quality choices and request limits. The [Assistant user guide](docs/agent/usage.md) explains provider setup and everyday use.

## Development Invariants

1. Do not restore project-level library/data/log paths or configurable internal filenames.
2. Never write library-owned data outside its root.
3. Renderer never accesses the filesystem directly.
4. Media never store unregistered album/tag/person/location references or registry display text.
5. `Location.Detail` is neither registry data nor a location filter.
6. Derive children from `ParentId`; reject cycles.
7. Maintenance never guesses a missing `--library` path.
8. Never skip corrupt JSONL lines and continue opening.
9. Registry and media deletion must use their recoverable transactions; backup failure blocks writes. Media deletion removes files and metadata but never prunes zero-use registry definitions.
10. Probe failure does not remove customization access.
11. Do not rehash/reprobe unchanged large videos.
12. Media/library changes must clear old sound, menus, transforms, and library-scoped recents.
13. Use `MediaId`, not `FilePath` or hash, for media state, IPC, and relationships.
14. All entity IDs are lowercase UUID v4 and globally unique across media and registries.
15. Check both recovery journals before ordinary writes or maintenance; recover deletion before text transactions while holding the library lock. Cleanup failure after a durable commit must not roll back committed in-memory state.
16. Validate current technical structures at disk boundaries without coercing persisted metadata or narrowing parser-provided EXIF representations. Registry and library requests must not publish into a replacement renderer context.
17. Semantic vectors are derived snapshots: only explicit index maintenance changes them. Metadata edits never trigger embedding work; outdated notices belong only in Build Semantic Index. Use current MediaIds and visible controls to restrict every search.
18. Keep model assets in Local AppData and index objects inside the owning library. Do not send gallery media, metadata documents or vectors to the planning provider.

## Explicitly Out of Scope

- Database, cloud sync, multi-user or cross-process collaborative editing.
- Recent-library lists, nested libraries, symlink media, or external media references.
- Automatic filesystem monitoring.
- Album detail pages/covers or photo-group structures.
- Video proxy transcoding, subtitles, chapters, track switching, manual covers, remembered position, looping, screenshots, or frame-level retrieval.
- In-application backup restoration.

## Architecture Summary

PhotoManager combines application code and global settings with user-selected independent libraries whose management data are self-contained. One Electron coordinator process owns shared application state and any number of window-scoped library sessions. Every window owns at most one active library, its in-memory indexes, chat service, workers, and writes; sender-routed IPC prevents one renderer from reaching another window's session. A library can be moved or backed up together with `.photo_manager` and has no dependency on data paths inside the application directory.
