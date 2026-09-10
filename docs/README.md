# Project Documentation

[PROJECT.md](../PROJECT.md) is the entry point to the implementation specification. This directory is permanent, version-controlled project documentation. Application behavior and planned designs have separate owners.

## Implemented application reference

| Document | Contents |
| --- | --- |
| [Runtime Architecture](reference/architecture.md) | Platform and packaging, Electron/preload contracts, source ownership and dependency direction. |
| [Configuration and Data Locations](reference/configuration.md) | Roaming configuration, machine-local state and the library directory layout. |
| [Library Lifecycle and Persistence](reference/library-lifecycle.md) | Library identity and boundaries, opening/initialization, locking, backups and transaction recovery. |
| [Media and Registry Data Model](reference/data-model.md) | Strict media schemas, capture-time semantics, UUID registries and location relationships. |
| [Media Processing and Playback](reference/media-pipeline.md) | Scanning, incremental reuse, thumbnails, live playback and temporary transforms. |
| [Interface and Editing](reference/interface.md) | Gallery filtering, viewer drafts, shared location selectors and registry management. |
| [Maintenance and Acceptance](reference/maintenance-and-testing.md) | Application/CLI maintenance, required tests and Windows packaging acceptance. |
| [Native Agent Runtime](reference/agent-support.md) | Implemented agent flows, local models/indexes, receipt persistence and validation status. |

## Agent target design

The [native agent specification](agent-design/README.md) defines the selected implementation design, including [local embedding models](agent-design/local-embeddings.md), [provider configuration](agent-design/providers.md), [UI](agent-design/ui.md), [delivery and acceptance](agent-design/validation.md), and [consequences](agent-design/consequences.md). Implementation is in progress; the runtime reference records completed checks without implying that all release gates have passed.

## Ownership and updates

Source paths in documents are repository-relative unless explicitly stated otherwise. Each detailed page links back to its parent index. Use relative Markdown links for repository documents and source files; external technical references retain their source URLs.

Change the owning reference whenever implemented architecture, persisted data, lifecycle or major interactions change. Keep planned behavior labelled until delivered; a permanent design document is not evidence that a feature exists. Maintain current decisions rather than discussion transcripts. Do not store secrets, model binaries, generated indexes or user libraries under docs.
