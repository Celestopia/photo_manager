# PhotoManager Project Specification

This is the implementation-level specification for PhotoManager, intended for maintainers, reviewers, and future AI agents. It records the architecture, data contracts, interaction constraints, and failure-handling strategies implemented by the current code. If the code and this document disagree, first determine whether the difference is an incomplete migration or a defect; do not silently introduce a second set of rules.

This entry point and the linked references under `docs/reference` together form the implementation-level source of truth. Detailed contracts have one owning reference; update that reference when behavior changes.

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

The project is local-first. Core browsing and management do not depend on network services, library data are never uploaded, and no database is used. JSONL is the current source of truth.

The application interface is English-only; there is no localization layer or language selector. User-authored library names, titles, descriptions, registry values, paths, and other metadata remain unrestricted Unicode and are displayed exactly as stored. UI sorting and search use English (`en-US`) collation, and viewer timestamps use the fixed 24-hour `YYYY-MM-DD HH:mm:ss` format.

## Detailed References

| Reference | Owns |
| --- | --- |
| [Runtime Architecture](docs/reference/architecture.md) | Platform, Windows packaging, IPC contracts, source ownership and dependency boundaries. |
| [Configuration and Data Locations](docs/reference/configuration.md) | Roaming settings, machine-local state and the library directory layout. |
| [Library Lifecycle and Persistence](docs/reference/library-lifecycle.md) | Library identity, boundaries, startup, initialization, locking, backups and transaction recovery. |
| [Media and Registry Data Model](docs/reference/data-model.md) | Strict media fields, capture-time semantics, UUID registries and location relationships. |
| [Media Processing and Playback](docs/reference/media-pipeline.md) | Scanning, incremental reuse, thumbnails, video playback and temporary transforms. |
| [Interface and Editing](docs/reference/interface.md) | Gallery queries, selection, viewer drafts, location hierarchy and registry management. |
| [Maintenance and Acceptance](docs/reference/maintenance-and-testing.md) | Library maintenance, explicit CLI commands, tests and Windows release checks. |

See the [documentation index](docs/README.md) for navigation and maintenance conventions.

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
