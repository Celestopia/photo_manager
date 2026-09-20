# Maintenance and Acceptance

Library maintenance, explicit CLI commands, tests and Windows release checks.

Part of the [project specification](../../PROJECT.md). See the [documentation index](../README.md) for related references. Source paths in prose are relative to the repository root.

## Library Settings and Maintenance

The gallery settings menu, visible only in normal gallery mode, exposes library information/directories, metadata update, verification, thumbnail generation, CSV export, registry management, and return to entry.

`scripts/maintenance-worker.js` runs operations as child processes with structured progress, logs, and results. The UI shows phase/count/current path and supports copying reports or opening outputs/logs.

- Update: create an update backup, incrementally replace metadata, strictly reload indexes, and refresh without generating thumbnails.
- Verify: read-only rescan and full hashes; report missing metadata/files, changes, type mismatches, probe/read failures. Optional probe compares video status, duration, dimensions, and codec.
- Thumbnails: generate missing/stale or forcibly rebuild all, without editing metadata; then requery.
- Semantic index: download or import pinned models, inspect indexed/outdated coverage, then manually build missing/changed entries or force rebuild all. This indexes the whole library, independently of visible gallery filters, and preserves authoritative metadata. Existing vectors remain searchable until explicitly updated. See [Semantic Search](semantic-search.md).
- Video covers: generate missing/damaged first-frame covers for all indexed videos, independently of gallery filters. Optional force regenerates all; progress counts unique video hashes. Reports include generated, skipped (reused), failed, and sourceChanged counts. Individual decode failures continue; source changes require Update Metadata. Existing covers survive failed regeneration. The maintenance barrier stops and awaits viewer extraction before the worker starts; repeated runs reuse completed covers.
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
npm run build-video-covers -- --library "D:\Media\My Library"
npm run build-video-covers -- --library "D:\Media\My Library" --force
npm run build-semantic-index -- --library "D:\Media\My Library"
npm run build-semantic-index -- --library "D:\Media\My Library" --force
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

Semantic tests cover registry-backed input snapshots, video sampling, projection mathematics, filter eligibility before limiting, query cancellation, and submitted-versus-draft renderer state. After installing the pinned models and building the renderer, `node_modules/electron/dist/electron.exe tests/helpers/semantic-search-ui-smoke.cjs` exercises actual local inference, Enter/Search submission, IME, the Results control, viewer return, and maintenance reuse in an isolated temporary library. The helper writes a screenshot under ignored `release/`; it never opens the user's library. Model downloads are not part of `npm test`.

After packaging, set `SEMANTIC_PACKAGED=1` for that helper to load main/preload/renderer and maintenance code from `release/win-unpacked/resources/app.asar`, including unpacked ONNX Runtime dependencies. Unset the variable after this check. This complements launching the actual unpacked executable.

Assistant adds session, attachment, input-processing and fake-provider tests, plus isolated Electron UI and packaged-runtime smoke helpers. Their commands and validation boundaries are documented in [Viewer Chat Implementation](../agent/implementation.md#validation).

Packaging acceptance additionally requires `npm run pack:win`, launch on a Windows account without Node.js, FFmpeg/FFprobe validation, image/video thumbnail generation, all four maintenance operations, paths containing spaces and Unicode, multi-window sender isolation, concurrent different-library locks, same-library rejection, and confirmation that runtime writes remain confined to AppData and the active libraries. Verify launching `PhotoManager.exe` directly and moving the entire unpacked folder to a path containing spaces and Unicode. There are no installer, upgrade-wizard, or uninstall flows; close all windows before replacing program files.
