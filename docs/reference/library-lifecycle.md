# Library Lifecycle and Persistence

Status: implemented application behavior. Part of the [project specification](../../PROJECT.md); browse the [documentation index](../README.md). Source paths in this reference are relative to the repository root.

Library identity and boundaries, opening/initialization, locking, backups and transaction recovery.

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

1. Acquire Electron's single-instance lock; a second process activates the existing window.
2. Before Electron is ready, configure roaming/local global directories and read and normalize roaming `config.yml`.
3. Validate `ffmpeg.exe` and `ffprobe.exe`.
4. Create the window hidden, load the library-entry page, and show it maximized.
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
2. Create the manifest, directories, initialization marker, and exclusive lock.
3. Scan and build records one media file at a time.
4. Skip unreadable or unhashable new media and report them; retain readable but corrupt images/videos as failed-probe records.
5. Report duplicate SHA-256 values without rejecting initialization.
6. Atomically write metadata and four empty registries.
7. Write a committed marker and perform minimum read-back validation.
8. Remove the marker, release the initialization lock, and open normally through the main process.

Cancellation deletes the complete `.photo_manager` directory. Other failures retain `library.yml`, `initialization.json`, and the error log while removing incomplete data, caches, and temporary content for explicit diagnosis and retry.

### Opening and Closing

Opening validates before acquiring the exclusive lock. Only its holder can write. If a crash left a cross-file transaction, the journal is used to roll it back or finish cleanup before strict loading. After main-process indexes load, the renderer requests all four registries in parallel and then performs its first gallery query.

Returning to the entry page requires confirmation, is blocked by an unresolved viewer draft or running maintenance, clears renderer state and memory indexes, and releases the lock. The last-library path remains for a future manual entry. The application uses one instance, one window, and one active library.

## Locking and Concurrency

`library.lock` contains `LibraryId`, `SessionId`, `ProcessId`, `ProcessStartedAt`, `HostName`, and `ApplicationStartedAt`.

The lock is created with `wx`, allowing one holder per path. On Windows, PID and process start time are checked together to reduce false live-lock detection after PID reuse.

- A live lock can never be forcibly removed, including through low-level IPC.
- A corrupt or dead-process lock may be forcibly removed only after displaying the risk and lock details and receiving confirmation.
- The main process retains the lock while a maintenance worker runs and passes its random `SessionId`; the worker verifies that the parent still owns that lock.
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
- Global deletion and library-name changes create an immediate snapshot every time.
- Incremental metadata update creates an update snapshot every time.

A snapshot includes `library.yml` and all five JSONL files, but not original media, thumbnails, CSV, logs, or temporary files. `backup.retentionCount` counts snapshot directories; the oldest are removed beyond the limit. Backup failure blocks the real write. The current UI has no restore operation; backups support manual diagnosis and future recovery tooling.

### Multi-File Transactions

Global tag, person, album, or location deletion normally changes both a registry and `photo_metadata.jsonl`. `scripts/library-transaction.js` performs:

1. Write old and new versions of every target under `temp/transactions/<uuid>`.
2. Atomically write `transaction.json` in the prepared state.
3. Atomically replace each target, updating the applied count after each one.
4. Mark committed and clean the transaction directory and journal.
5. On an exception, immediately restore every old version.
6. On the next open after a crash, roll back an incomplete commit or clean an entirely applied commit according to the journal.

An unparseable journal or missing rollback file rejects opening rather than guessing. Main-process global deletion keeps old in-memory objects only for media whose references actually change and transacts with copied replacements; unaffected media preserve object and Map identity. Do not deep-clone the entire active metadata set merely to simplify rollback.
