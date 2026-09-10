# Maintenance and Acceptance

Library maintenance, explicit CLI commands, tests and Windows release checks.

Part of the [project specification](../../PROJECT.md). See the [documentation index](../README.md) for related references. Source paths in prose are relative to the repository root.

## Library Settings and Maintenance

The gallery settings menu, visible only in normal gallery mode, exposes library information/directories, metadata update, verification, thumbnail generation, CSV export, registry management, and return to entry.

`scripts/maintenance-worker.js` runs operations as child processes with structured progress, logs, and results. The UI shows phase/count/current path and supports copying reports or opening outputs/logs.

- Update: create an update backup, incrementally replace metadata, strictly reload indexes, and refresh without generating thumbnails.
- Verify: read-only rescan and full hashes; report missing metadata/files, changes, type mismatches, probe/read failures. Optional probe compares video status, duration, dimensions, and codec.
- Thumbnails: generate missing/stale or forcibly rebuild all, without editing metadata; then requery.
- CSV: fixed output at `.photo_manager/data/photo_metadata.csv`, overwrite confirmation, UTF-8 BOM, flattened user/technical fields, IDs plus resolved names, type-specific blank columns, and location ID/name/detail without duplicated administrative fields.

## CLI Maintenance

Every script requires `--library` and shares path, lock, strict loading, and FFmpeg configuration:

```powershell
npm run init-metadata -- --library "D:\Media\My Library"
npm run update-metadata -- --library "D:\Media\My Library"
npm run verify-metadata -- --library "D:\Media\My Library"
npm run verify-metadata -- --library "D:\Media\My Library" --probe
npm run build-thumbnails -- --library "D:\Media\My Library"
npm run build-thumbnails -- --library "D:\Media\My Library" --force
npm run export-metadata-csv -- --library "D:\Media\My Library"
```

Missing `--library` fails immediately. No script infers a path from configuration.

## Tests and Acceptance

The `node:test` suite covers CSV schema/escaping; library boundaries, manifests, strict JSONL, locks, backups, and rollback; image/video probing, FFmpeg integration, thumbnail cleanup, and time-zone/DST ambiguity; incremental reuse/change/move/copy/failure behavior; playback, frame stepping, transforms, and keyboard focus; configuration/runtime isolation; gallery filters/counts/grouping; UUID and registry schemas; rating/privacy mutations; renderer details; and location hierarchy/search.

Minimum checks:

```powershell
npm test
npm run build:renderer
node --check src/main/main.js
node --check src/main/preload.js
node --check scripts/*.js  # use a reliable per-file PowerShell loop
npm run verify-metadata -- --library "<library-path>"
git diff --check
```

Desktop acceptance also covers entry prefilling/manual open, lock warnings, settings and maintenance progress, returning to entry, image viewing, and video fallback.

Packaging acceptance additionally requires `npm run pack:win`, launch on a Windows account without Node.js, FFmpeg/FFprobe validation, image/video thumbnail generation, all four maintenance operations, paths containing spaces and Unicode, single-instance and lock behavior, and confirmation that runtime writes remain confined to AppData and the active library. Public installers must be Authenticode-signed and tested through install, upgrade, and uninstall flows.
