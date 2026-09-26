# Maintenance and Acceptance

Library maintenance, explicit CLI commands, tests and Windows release checks.

Part of the [project specification](../../PROJECT.md). See the [documentation index](../README.md) for related references. Source paths in prose are relative to the repository root.

## Library Settings and Maintenance

The gallery settings menu, visible only in normal gallery mode, exposes library information/directories, metadata update, verification, thumbnail generation, CSV export, registry management, and return to entry.

`scripts/maintenance-worker.js` runs operations as child processes with structured progress, logs, and results. The UI shows phase/count/current path and supports copying reports or opening outputs/logs.

Desktop maintenance writes readable daily UTC logs under the operation library's `.photo_manager/logs`; initialization uses application logs until the management directory exists. Each run has an ID, start entry with application version and force/reprobe flags, phase/current-path progress snapshots with combined counts such as `progress=482/557` at most once per two seconds within a phase, and a terminal summary with elapsed milliseconds and numeric result counters. Phase changes, final progress and explicit warnings/errors are logged immediately; UI progress is not throttled. Warnings, errors or failed/changed-source items produce a partial outcome. Worker failures retain their original stack, code and exit status/signal. Maintenance resolves and releases its active-worker barrier only on child `close`, after queued IPC results are received; `exit` alone is not completion. Spawn errors are retained and rejected through the same close-time cleanup. Routine reused items do not get individual log entries.

Log values preserve Unicode and escape newlines. Only selected progress fields, numeric summary counts and relevant options are recorded; configuration objects and chat contents are not serialized. Common credential patterns are redacted and text is bounded. Logging failures do not block normal operations. Library open/close, registry/media deletion summaries and recovery/cleanup errors are also logged. Existing files are retained without migration. Cover diagnostics distinguish source checks, invalid-cache regeneration, extraction, output validation and publication; changed-source diagnostics include expected and actual size/mtime.


- Update: create an update backup, incrementally replace metadata, strictly reload indexes, and refresh without generating thumbnails.
- Verify: read-only rescan and full hashes; report missing metadata/files, changes, type mismatches, probe/read failures. Optional probe compares video status, duration, dimensions, and codec.
- Thumbnails: generate missing/stale or forcibly rebuild all, without editing metadata; then requery.
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

Assistant adds session, attachment, input-processing and fake-provider tests, plus isolated Electron UI and packaged-runtime smoke helpers. Their commands and validation boundaries are documented in [Viewer Chat Implementation](../agent/implementation.md#validation).

Packaging acceptance additionally requires `npm run pack:win`, launch on a Windows account without Node.js, FFmpeg/FFprobe validation, image/video thumbnail generation, all four maintenance operations, paths containing spaces and Unicode, multi-window sender isolation, concurrent different-library locks, same-library rejection, and confirmation that runtime writes remain confined to AppData and the active libraries. Verify launching `ptmgr-gui.exe` directly and moving the entire unpacked folder to a path containing spaces and Unicode. There are no installer, upgrade-wizard, or uninstall flows; close all windows before replacing program files.

Set `DIALOG_SHELL_SMOKE=1` when running `tests/helpers/chat-ui-smoke.cjs` with Electron to check shared dialog styling, nested registry modals, focus restoration, background isolation, and owner-specific Escape handling against an isolated test library.

Set `SHARED_UI_SMOKE=1` with the same isolated Electron helper to verify shared registry fields, album description validation, Unicode and case-insensitive search, edit shortcuts, location parent selection, customization creation and Assistant tooltips.

Set `LOGGING_SMOKE=1` with `tests/helpers/chat-ui-smoke.cjs` to check real worker start/result logs and close-time library log routing against an isolated test library.

## Maintenance Time Estimates

The maintenance dialog shows total elapsed time, retained on completion, and an approximate current-stage remaining time. Estimates reset on phase changes, require at least three progress advances spanning five seconds, use a recent 30-second throughput window, and round upward to seconds and count down on each one-second UI tick between progress events. Unknown totals, unsampled workloads and ten seconds without progress or an exhausted prediction display Estimating; write/commit/complete phases display Finishing until the worker closes. These estimates are advisory, especially for unusually large files and changing storage speeds.

Thumbnail estimates track uncached image and video work separately and use the slower remaining lane; video-cover estimates exclude existing cache entries and reset when an invalid cache increases the generation workload. Metadata processing estimates use changed-file bytes, excluding unchanged records. Scanning and export can remain indeterminate. Timing belongs to the window's library session; timers stop on completion, failure, library closure and disposal. Warning events preserve phase progress. Set `ETA_SMOKE=1` with the isolated Electron smoke helper to check elapsed time in the maintenance dialog.
