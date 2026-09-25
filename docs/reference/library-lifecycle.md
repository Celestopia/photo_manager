# Library Lifecycle and Persistence

Library identity, boundaries, startup, initialization, locking, backups and transaction recovery.

Part of the [project specification](../../PROJECT.md). See the [documentation index](../README.md) for related references. Source paths in prose are relative to the repository root.

## Library Identity and Manifest

`library.yml` is required to identify a library:

```yaml
schemaVersion: 4
libraryId: 0fbd075b-f63e-41d0-91d9-39ea17487df7
name: My Library
createdAt: '2026-07-12T17:11:52.985Z'
updatedAt: '2026-07-12T17:13:02.959Z'
```

Constraints:

- `libraryId` is the UUID generated when the library is created and is its stable identity.
- Moving the library does not change its UUID or identity.
- `name` is an editable display name from 1 to 100 characters.
- `schemaVersion` must equal the current version, `4`. The application contains no historical parser, compatibility layer, or automatic migration. Other versions require an explicit one-time conversion before opening.
- Only the five fields above are allowed. Missing or extra fields, parse failures, invalid UUIDs, or invalid timestamps make the library corrupt.
- Opening is rejected if any of the five fixed JSONL files is missing.

## Library Boundary Rules

Every entry point and CLI maintenance script follows the same boundaries:

1. The root must exist, be writable, and not be a Windows drive root.
2. The root cannot be a symbolic link.
3. Scanning does not follow symbolic-link files or directories.
4. A library cannot be created or opened below another library.
5. A library cannot contain another `.photo_manager` directory.
6. Only media inside the root are managed. Metadata `FilePath` values must be relative paths that cannot escape it.
7. Path keys are case-sensitive strings. Windows normally prevents entities that differ only by case, but the application does not collapse them.
8. There is no live filesystem monitoring. Users run “Update Metadata” after adding, removing, moving, or renaming media.

`scripts/library-core.js` is the sole shared implementation of path resolution, manifests, strict JSONL, and atomic text writes. Do not reconstruct internal library paths elsewhere.

## Library Lifecycle

### Application Startup

1. Acquire Electron's single-instance coordinator lock; a later launch asks that coordinator to create another independent entry window.
2. Before Electron is ready, configure roaming/local global directories and read and normalize roaming `config.yml`.
3. Validate `ffmpeg.exe` and `ffprobe.exe`.
4. Create the first window and its isolated session hidden, load the library-entry page, and show it maximized.
5. If a last successful path exists, read the actual name from its manifest and prefill the name and full path without loading it.
6. Validate and load only after the user enters or selects an existing library.
7. Enter the gallery and update the last-library path only after the lock, manifest, five JSONL files, and all memory indexes load successfully.

When FFmpeg is unavailable, the entry page and error remain available, but no library can be initialized or opened.

### Directory Selection

After selection, the main process checks:

- A valid `.photo_manager` enters the open flow.
- A failed-initialization marker displays its reason and allows explicit cleanup, rescan, and retry.
- Without `.photo_manager`, a cancellable quick scan counts supported media before showing initialization confirmation.
- A reserved directory that is not a valid library is reported as corruption rather than treated as uninitialized.

The quick scan writes no library data.

### Initialization

Initialization requires an explicit warning and confirmation stating that it will recursively scan supported media, calculate full SHA-256 hashes, read EXIF, run FFprobe, create the management structure, leave original media untouched, potentially take a long time, remove incomplete data on cancellation, and reject nested libraries.

Flow:

1. Revalidate paths, parent/child nesting, and FFmpeg.
2. Claim `.photo_manager` with an exclusive directory creation, recheck parent/child nesting, then create the manifest, directories, initialization marker, and exclusive lock. A competing initializer that did not claim the directory never modifies or removes it.
3. Scan and build records one media file at a time.
4. Skip unreadable or unhashable new media and report them; retain readable but corrupt images/videos as failed-probe records.
5. Report duplicate SHA-256 values without rejecting initialization.
6. Atomically write metadata and four empty registries.
7. Write a committed marker and perform minimum read-back validation.
8. Remove the marker, release the initialization lock, and open normally through the main process.

Cancellation deletes only the `.photo_manager` directory owned by that initialization attempt. Other failures after structure creation retain `library.yml`, `initialization.json`, and the error log while removing incomplete data, caches, and temporary content for explicit diagnosis and retry. The initialization lock remains held through owned cleanup, and the cancellation listener is always removed.

### Opening and Closing

Opening validates before acquiring the exclusive lock. Only its holder can write. If a crash left a media-deletion or cross-file data transaction, its journal is used to roll back or finish cleanup before strict loading. Media-deletion recovery runs first because it may restore media files or finalize a metadata commit. After main-process indexes load, the renderer requests all four registries in parallel and then performs its first gallery query.

Returning to the entry page requires confirmation, is blocked by an unresolved viewer draft or running maintenance, clears that window's renderer state and memory indexes, and releases its lock. Closing a window first cancels its quick scan, stops its Assistant work, drains outstanding IPC operations, and safely closes only that session. Maintenance blocks only its owning window. The application exits after the last window closes.

Launching Photo Manager again creates another entry window rather than activating an existing one. Every new window prefills the globally most recently opened library but still requires an explicit Open action. There is no in-application New Window command. Different windows may open different libraries concurrently; each retains one active library at a time.

## Locking and Concurrency

`library.lock` contains `LibraryId`, `SessionId`, `ProcessId`, `ProcessStartedAt`, `HostName`, and `ApplicationStartedAt`.

The lock is created with `wx`, allowing one holder per path. On Windows, PID and process start time are checked together to reduce false live-lock detection after PID reuse.

- A live lock can never be forcibly removed, including through low-level IPC.
- A corrupt or dead-process lock may be forcibly removed only after displaying the risk and lock details and receiving confirmation.
- The main process retains the lock while a maintenance worker runs and passes its random `SessionId`; the worker verifies that the parent still owns that lock.
- The coordinator reserves each open `LibraryId` in memory as well as acquiring its path-local lock, preventing simultaneous access to copied roots with the same logical identity.
- Different window sessions may concurrently hold locks for different libraries; closing one window never releases another window's lock.
- Standalone CLI tools acquire the same lock and cannot maintain a library concurrently with the application.
- Maintenance cannot be cancelled. While it runs, the library is read-only and cannot be switched or closed.

## Persistence, Backups, and Transactions

### Strict JSONL

Every JSONL file contains one object per line. Opening strictly requires:

- Every non-empty line to be a valid JSON object.
- Every media record to have non-empty, unique `MediaId` and `FilePath` values.
- Tag, album, person, and location definitions to have `TagId`, `AlbumId`, `PersonId`, and `LocationId` respectively.
- Every entity ID to be a lowercase UUID v4 globally unique across media and all four registries.
- Tag `Text`, album `Title`, and person `Name` to be non-empty and unique within their registries.
- Locations may share names, but identical `(Name, Country, Province, City, ParentId)` contexts are forbidden.
- Every media registry reference and every location `ParentId` to resolve, with no parent cycle.
- Any invalid line or duplicate key to reject the entire library rather than skipping bad rows.

Partial loading could cause a later write to overwrite unloaded data, so explicit rejection is the safer policy.

### Atomic Single-File Writes

`writeTextAtomic` and `writeJsonlAtomic` create a unique temporary file beside the target, write it completely, replace the target by rename, and clean residual temporary files in `finally`. Main-process Maps are active-session query indexes; JSONL remains persistent truth.

### Automatic Backups

A backup must precede every user-data write:

- Ordinary edits and registry creation/update create the first daily snapshot of that day.
- Registry deletion, media deletion, and library-name changes create an immediate snapshot every time.
- Incremental metadata update creates an update snapshot every time.

A snapshot includes `library.yml` and all five JSONL files, but not original media, thumbnails, CSV, logs, or temporary files. `backup.retentionCount` counts snapshot directories; the oldest are removed beyond the limit. Backup failure blocks the real write. The current UI has no restore operation; backups support manual diagnosis and future recovery tooling.

### Multi-File Transactions

Global tag, person, album, or location deletion normally changes both a registry and `photo_metadata.jsonl`. `scripts/library-transaction.js` performs:

1. Write old and new versions of every target under `temp/transactions/<uuid>`.
2. Atomically write `transaction.json` in the prepared state.
3. Atomically replace each target, updating the applied count after each one.
4. Once all targets and their applied counts are durable, mark committed and clean the journal before its temporary directory.
5. Before durable completion, an exception restores old versions. After durable completion, journal/temporary cleanup failure reports a committed outcome with cleanup pending; callers retain the committed in-memory result.
6. On the next open after a crash, roll back an incomplete commit or clean an entirely applied commit according to the journal.

An unparseable journal or missing rollback file rejects opening rather than guessing. Main-process global deletion keeps old in-memory objects only for media whose references actually change and transacts with copied replacements; unaffected media preserve object and Map identity. Do not deep-clone the entire active metadata set merely to simplify rollback.

`scripts/library-recovery.js` is the shared readiness boundary. Opening and metadata update recover media deletion before text transactions under an authorized lock, before loading/scanning records. Other maintenance and ordinary mutations refuse either unresolved journal. A remaining committed journal still requires recovery; an orphaned temporary directory after journal removal cannot reverse a commit. Metadata edits prepare replacement records and their renderer results before publishing or persisting, so enrichment errors cannot cause partial edits or post-commit rollback.

Opening and maintenance validate required technical structures, fingerprint syntax, and the existing nullable probe representations at disk boundaries. Reference and uniqueness validation remains separate. Validation does not normalize, migrate, repair, or rewrite records.

## Permanent Media Deletion

Single-viewer and gallery-batch deletion share one all-or-nothing operation. After explicit confirmation, active media handles and chat generation are stopped, an immediate metadata backup is created, and every target path is revalidated as a regular file inside the active library. Files are renamed into `.photo_manager/temp/media-deletions/<uuid>/`, then `photo_metadata.jsonl` is atomically replaced without the target `MediaId` records. Only after that commit are staged files permanently removed.

`.photo_manager/media-deletion.json` records the complete deletion set. Recovery restores staged files when all target records still exist, or finishes staged-file cleanup when all are absent; a partial metadata set or ambiguous source/stage pair rejects opening. Empty source directories, sidecars, CSV exports, chat history, and registry definitions are not removed. A hash thumbnail is removed only when no remaining record shares it.
