# Project Documentation

[PROJECT.md](../PROJECT.md) is the entry point to the implemented PhotoManager specification. The files in this directory are permanent project documentation and belong in version control.

## Reference Index

| Reference | Owns |
| --- | --- |
| [Runtime Architecture](reference/architecture.md) | Platform, Windows packaging, IPC contracts, source ownership and dependency boundaries. |
| [Configuration and Data Locations](reference/configuration.md) | Roaming settings, machine-local state and the library directory layout. |
| [Library Lifecycle and Persistence](reference/library-lifecycle.md) | Library identity, boundaries, startup, initialization, locking, backups and transaction recovery. |
| [Media and Registry Data Model](reference/data-model.md) | Strict media fields, capture-time semantics, UUID registries and location relationships. |
| [Media Processing and Playback](reference/media-pipeline.md) | Scanning, incremental reuse, thumbnails, video playback and temporary transforms. |
| [Interface and Editing](reference/interface.md) | Gallery queries, selection, viewer drafts, location hierarchy and registry management. |
| [Maintenance and Acceptance](reference/maintenance-and-testing.md) | Library maintenance, explicit CLI commands, tests and Windows release checks. |

## Assistant

The [viewer chat reference](agent/README.md) documents the implemented Assistant, its input processing and conversation storage. Start with [Using Assistant](agent/usage.md) for provider configuration and everyday use.

## Maintenance Conventions

- Keep product scope, development invariants and explicit exclusions in the root PROJECT.md.
- Read and update the owning reference when architecture, persisted data, lifecycle rules or major interactions change.
- Document the implemented application; do not import prototype behavior from another branch.
- Treat source paths in prose as repository-relative; use relative Markdown links for documentation navigation.
- Preserve strict schema examples, commands and failure-handling rules when reorganizing content.
- Keep generated artifacts, credentials and library data out of docs.
