# CLI automation and lifecycle

Use the executable directly for scripting. `--format json` writes one result object; `--format jsonl` writes individual list records and writes no records for an empty result. Result data go to stdout. Progress, warnings, errors, prompts, and list counts go to stderr. JSON/JSONL command errors use an `error` object; argument-parser failures use plain diagnostics. Do not parse the human-readable text format as a stable schema.

| Exit code | Meaning |
| --- | --- |
| 0 | Success, including an empty query or no-op edit. |
| 1 | Operational, data-validation, or filesystem failure. |
| 2 | Argument/usage error or required noninteractive confirmation missing. |
| 3 | Target library is locked by an active session. |
| 4 | Completed with maintenance failures or verification findings. Inspect counters. |
| 5 | Pending transaction or incomplete initialization requires attention. |
| 130 | Cancelled. |

Every library operation uses the exclusive lock, including inspection and dry runs. Close that library in the GUI first. Different libraries may be used independently. The CLI shares general processing configuration in `%APPDATA%\PhotoManager\app-data\config.yml`, but never reads the GUI's last-library state or opens its Electron profile. Help and version do not initialize configuration or open a library.

Initialization, multi-item edits, registry deletion, CSV overwrites, recovery, and stale-lock removal require confirmation. Interactive terminals prompt; automation must provide `--yes`. `--yes` grants confirmation only and never bypasses validation, backups, or locking. Single-item edits and registry create/update commands act on their explicit target without a prompt.

Read operations and dry runs do not create backups or library operation logs. They briefly create and release the exclusive lock and may initialize missing application configuration. Writes retain existing daily/immediate backup rules. Registry deletion uses the shared multi-file transaction; batch media edits use one atomic metadata-file replacement. All input validation completes before publishing a batch edit.

Ctrl+C requests cancellation. Scans, hash streams, queue scheduling, and supported FFmpeg work stop at safe points; active non-cancellable native work finishes before the lock is released. A commit already in progress is allowed to finish. Completed derived cache entries may remain. The CLI awaits active work and releases its lock; forced process termination can leave a stale lock or recovery journal.

Ordinary commands refuse pending recovery journals rather than repairing silently. `library recover --yes` explicitly runs shared transaction recovery while holding the lock. `library unlock --yes` removes only a stale lock whose same-computer owner is no longer active. Failed initialization markers require manual inspection; transaction recovery does not reinterpret them as a complete library. Neither command overrides a live GUI or CLI owner.

Mutation and maintenance runs use existing logs under `.photo_manager/logs`, with application logs used before initialization creates that directory. Logs include command, version, progress, outcome, and numeric counts; edit payloads and full metadata are not logged. JSON output intentionally includes user metadata, so choose projections or protect redirected files as needed.
