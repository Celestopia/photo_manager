# PhotoManager Project Design

This is the implementation-level specification for PhotoManager, intended for maintainers, reviewers, and future AI agents. It records the architecture, data contracts, interaction constraints, and failure-handling strategies implemented by the current code. If the code and this document disagree, first determine whether the difference is an incomplete migration or a defect; do not silently introduce a second set of rules.

## 1. Product Scope

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

## 2. Platform, Technology, and Boundaries

- Target: Windows 10/11 x64.
- Desktop container: Electron 44.
- Renderer: Vue 3 SFC and Vite.
- Image parsing and thumbnails: Sharp and exifr.
- Video probing and frame extraction: bundled Windows x64 FFmpeg/FFprobe 8.1.2.
- Capture-location time zones: offline `geo-tz` coordinate boundaries plus Electron/Node `Intl` IANA time-zone rules; no runtime network request is made.
- Configuration: YAML.
- Persistence: JSONL; export: UTF-8 BOM CSV.
- The main process and renderer communicate through an explicit IPC allowlist. The renderer cannot access Node or the filesystem directly.

Supported media extensions:

- Images: `.jpg`, `.jpeg`, `.png`, `.bmp`, `.webp`, `.gif`.
- Videos: `.mp4`, `.mov`, `.mkv`, `.avi`.

An extension only determines scan eligibility. A record may still exist when its contents are damaged or its codec is unsupported; `Picture.ProbeStatus` or `Video.ProbeStatus` represents the technical parsing state.

### 2.1 Windows Packaging

`electron-builder.yml` defines an x64 NSIS assisted installer and an unpacked smoke-test target. The package contains the main process, preload, shared schemas, internal maintenance scripts, the built renderer, and production dependencies inside `app.asar`. Sharp's native packages are unpacked. FFmpeg and FFprobe are copied as executable program resources to `resources/tools/ffmpeg/bin`; they are never stored in ASAR or copied to AppData.

The installed runtime distinguishes the code root from the program-resource root. The code root contains `app.asar` and is used to load the renderer, preload, and maintenance worker. The program-resource root is the repository root in development and `process.resourcesPath` when packaged. `PHOTO_MANAGER_RESOURCE_ROOT` passes that real directory to maintenance child processes, which also use it as their working directory. Standalone scripts fall back to the repository root when the variable is absent. This prevents executable lookup and child-process working directories from resolving inside the read-only ASAR virtual filesystem.

`npm run pack:win` builds the renderer and creates an unpacked application under `release/win-unpacked/`. `npm run dist:win` first runs all tests, builds the renderer, and creates `release/PhotoManager-<version>-x64-Setup.exe`. Release builds require the Git LFS FFmpeg files to be materialized. Code signing is optional for local builds but required by release policy before public distribution; credentials must come from the environment and must never be committed.

## 3. Application Configuration and Library Data

### 3.1 Application Configuration

`%APPDATA%\PhotoManager\app-data\config.yml` contains only application settings shared by every library and suitable for roaming with the user:

- `thumbnail`: dimensions, WebP quality, extreme-aspect threshold, and image concurrency.
- `media`: FFmpeg directory, probe timeout, extraction timeout, and video-thumbnail concurrency.
- `backup.retentionCount`: maximum retained backup snapshots per library, with a minimum of 1.
- `ui`: gallery card width, viewer panel ratios and default visibility, and zoom range.

`config.yml` does not contain library paths or data, thumbnail, or log directories. Individual libraries cannot override thumbnail or UI settings. The installation directory contains only programs, dependencies, and program resources such as FFmpeg; it contains no live configuration or runtime state.

The application and standalone maintenance scripts use the same configuration module. When the file is absent, the caller creates its parent directory, writes the complete defaults, and continues. Invalid YAML is left untouched and defaults are used for that run. There is no runtime configuration UI; the renderer can only read normalized configuration.

An absolute `media.ffmpegDir` is used directly. A relative value is always resolved from the program-resource root, never from the relocated AppData configuration directory. In development that root is the project root; in an installed build it is Electron's `resources` directory.

### 3.2 Private Application State

Global data are split between roaming configuration and machine-specific state:

```text
%APPDATA%\PhotoManager\
  app-data\
    config.yml
  electron\                 # Electron userData and small internal preferences

%LOCALAPPDATA%\PhotoManager\
  app-data\
    state.json
  logs\                     # startup diagnostics produced before a library opens
  session-data\             # localStorage, Chromium cache, and session state
  crash-dumps\
```

`state.json` contains only the last successfully opened library path. Because that path is machine-specific, it is not stored under roaming data. Video volume and mute plus the recent tags, people, and locations namespaced by library UUID remain in renderer `localStorage`, whose physical storage follows Electron `sessionData` into Local AppData. Cache and crash dumps must not pollute roaming data.

Before Electron becomes ready, the main process must create these directories and explicitly set `userData`, `sessionData`, `crashDumps`, and the log path. `scripts/application-paths.js` is the only shared source of global path rules for Electron and standalone CLI tools. Other modules must not reconstruct AppData paths. The application does not permanently read the former installation-root `config.yml`; upgrading to v0.25.0 requires a one-time manual copy of customized configuration. Low-value recent-choice and playback preferences may reset.

The application does not maintain a recent-library list. Startup always shows the library-entry page. If a last successful path exists, its real name is read from `library.yml` and displayed with the full path, but the library is not loaded until the user chooses to enter it.

### 3.3 Library Directory

A library is the selected media root. All PhotoManager data belonging to it must be inside:

```text
<library-root>/.photo_manager/
```

Standard layout:

```text
<library-root>/
  media files and user directories...
  .photo_manager/
    library.yml
    library.lock                  # exists only while open or while a script runs
    initialization.json          # exists only during/after failed initialization
    transaction.json             # exists only while a cross-file commit is incomplete
    data/
      photo_metadata.jsonl
      tag_registry.jsonl
      album_registry.jsonl
      person_registry.jsonl
      location_registry.jsonl
      photo_metadata.csv          # may exist after export
    thumb_cache/
      cache_manifest.json
      <SHA256Hash>.webp
    backups/
      <timestamp>-<kind>-<suffix>/
        library.yml
        five JSONL files...
        manifest.json
    logs/
      YYYY-MM-DD.log
      initialization-failed.log   # may exist after failed initialization
    temp/
      transactions/
      temporary video-thumbnail files...
```

`.photo_manager` is not given the Windows hidden attribute. The scanner excludes only this reserved directory at the library root; other ordinary hidden directories are still scanned.

## 4. Library Identity and Manifest

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

## 5. Library Boundary Rules

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

## 6. Library Lifecycle

### 6.1 Application Startup

1. Acquire Electron's single-instance lock; a second process activates the existing window.
2. Before Electron is ready, configure roaming/local global directories and read and normalize roaming `config.yml`.
3. Validate `ffmpeg.exe` and `ffprobe.exe`.
4. Create the window hidden, load the library-entry page, and show it maximized.
5. If a last successful path exists, read the actual name from its manifest and prefill the name and full path without loading it.
6. Validate and load only after the user enters or selects an existing library.
7. Enter the gallery and update the last-library path only after the lock, manifest, five JSONL files, and all memory indexes load successfully.

When FFmpeg is unavailable, the entry page and error remain available, but no library can be initialized or opened.

### 6.2 Directory Selection

After selection, the main process checks:

- A valid `.photo_manager` enters the open flow.
- A failed-initialization marker displays its reason and allows explicit cleanup, rescan, and retry.
- Without `.photo_manager`, a cancellable quick scan counts supported media before showing initialization confirmation.
- A reserved directory that is not a valid library is reported as corruption rather than treated as uninitialized.

The quick scan writes no library data.

### 6.3 Initialization

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

### 6.4 Opening and Closing

Opening validates before acquiring the exclusive lock. Only its holder can write. If a crash left a cross-file transaction, the journal is used to roll it back or finish cleanup before strict loading. After main-process indexes load, the renderer requests all four registries in parallel and then performs its first gallery query.

Returning to the entry page requires confirmation, is blocked by an unresolved viewer draft or running maintenance, clears renderer state and memory indexes, and releases the lock. The last-library path remains for a future manual entry. The application uses one instance, one window, and one active library.

## 7. Locking and Concurrency

`library.lock` contains `LibraryId`, `SessionId`, `ProcessId`, `ProcessStartedAt`, `HostName`, and `ApplicationStartedAt`.

The lock is created with `wx`, allowing one holder per path. On Windows, PID and process start time are checked together to reduce false live-lock detection after PID reuse.

- A live lock can never be forcibly removed, including through low-level IPC.
- A corrupt or dead-process lock may be forcibly removed only after displaying the risk and lock details and receiving confirmation.
- The main process retains the lock while a maintenance worker runs and passes its random `SessionId`; the worker verifies that the parent still owns that lock.
- Standalone CLI tools acquire the same lock and cannot maintain a library concurrently with the application.
- Maintenance cannot be cancelled. While it runs, the library is read-only and cannot be switched or closed.

## 8. Persistence, Backups, and Transactions

### 8.1 Strict JSONL

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

### 8.2 Atomic Single-File Writes

`writeTextAtomic` and `writeJsonlAtomic` create a unique temporary file beside the target, write it completely, replace the target by rename, and clean residual temporary files in `finally`. Main-process Maps are active-session query indexes; JSONL remains persistent truth.

### 8.3 Automatic Backups

A backup must precede every user-data write:

- Ordinary edits and registry creation/update create the first daily snapshot of that day.
- Global deletion and library-name changes create an immediate snapshot every time.
- Incremental metadata update creates an update snapshot every time.

A snapshot includes `library.yml` and all five JSONL files, but not original media, thumbnails, CSV, logs, or temporary files. `backup.retentionCount` counts snapshot directories; the oldest are removed beyond the limit. Backup failure blocks the real write. The current UI has no restore operation; backups support manual diagnosis and future recovery tooling.

### 8.4 Multi-File Transactions

Global tag, person, album, or location deletion normally changes both a registry and `photo_metadata.jsonl`. `scripts/library-transaction.js` performs:

1. Write old and new versions of every target under `temp/transactions/<uuid>`.
2. Atomically write `transaction.json` in the prepared state.
3. Atomically replace each target, updating the applied count after each one.
4. Mark committed and clean the transaction directory and journal.
5. On an exception, immediately restore every old version.
6. On the next open after a crash, roll back an incomplete commit or clean an entirely applied commit according to the journal.

An unparseable journal or missing rollback file rejects opening rather than guessing. Main-process global deletion keeps old in-memory objects only for media whose references actually change and transacts with copied replacements; unaffected media preserve object and Map identity. Do not deep-clone the entire active metadata set merely to simplify rollback.

## 9. Media Metadata Model

Each line of `photo_metadata.jsonl` is one media record. Images and videos share the top-level structure and are distinguished by `FileSystem.FileType`.

### 9.1 Top-Level Keys

```json
{
  "MediaId": "4a4ca2d8-d541-4fd3-9b2e-c018efb1d648",
  "FilePath": "events/example.mp4",
  "SHA256Hash": "...",
  "FileSystem": {},
  "GPS": {},
  "Location": {},
  "Camera": {},
  "Customization": {},
  "Video": {}
}
```

Images use `Picture` and do not create an empty `Video`; videos use `Video` and do not create an empty `Picture`.

- `MediaId`: stable lowercase UUID v4 identity within the library, used by main-process indexes, IPC edits, selection, viewer navigation, and frontend keys.
- `FilePath`: current path relative to the root; mutable after moves or renames and used only to locate and label the file.
- `SHA256Hash`: content fingerprint used for integrity, move recognition, duplicate detection, and thumbnail cache names. Same-content copies may share a hash but require distinct `MediaId` values.

Moving or renaming within one library preserves `MediaId`. A second coexisting copy receives a new ID. Copying only the original file to another library also produces a new ID because no source-library metadata accompanies it.

### 9.2 `FileSystem`

- `FileType`: `image` or `video`.
- `FileExtension`: lowercase extension without the dot.
- `FileSize`: bytes.
- `ShootingTimeString/Zone/Stamp`: capture time for timeline sorting. `String` is wall-clock time at the capture location, `Zone` is the UTC-hour offset active on that date, and `Stamp` is Unix seconds for the same instant.
- `CreationTimeString/Zone/Stamp`: filesystem creation instant rendered in the media reference time zone.
- `ModificationTimeString/Zone/Stamp`: filesystem modification instant rendered in the media reference time zone.
- `ModificationTimeMs`: millisecond modification time, stored last in `FileSystem` for incremental reuse.

Capture time must not be implicitly converted through the current computer's time zone:

1. Images use raw EXIF `DateTimeOriginal` plus `OffsetTimeOriginal` when present, otherwise filesystem creation time.
2. Videos preserve FFprobe QuickTime, container, default-video-stream, and default-audio-stream creation candidates. Candidates with explicit non-UTC offsets have highest priority. Without a candidate, use file modification time.
3. When a source provides only an absolute UTC instant and GPS exists, `geo-tz` maps coordinates offline to an IANA zone and `Intl.DateTimeFormat` applies historical/daylight rules for that capture date. Never substitute a fixed standard offset.
4. UTC time without GPS remains UTC; do not infer capture location from paths, registered locations, or the host time zone.
5. A floating wall time receives `Zone/Stamp` only when GPS uniquely determines one instant. Repeated fall-back hours, nonexistent spring-forward times, or conflicting boundary zones retain the original `String` and store `null` for `Zone/Stamp`.
6. Derived IANA names are technical intermediates and are not persisted. Missing or invalid GPS creates no extra fields.

One deterministic media reference time zone renders all three time groups: an explicit non-UTC source offset wins; otherwise use a uniquely GPS-resolved IANA zone; otherwise use UTC. Creation and modification offsets are calculated at their own instants, so they may differ from capture offset across daylight-saving boundaries. All three `Stamp` values remain absolute Unix seconds.

Moving media refreshes creation/modification times using the reference zone reconstructed from existing capture time and GPS. All metadata follow current rules; no compatibility recognition or repair path exists for older time records.

### 9.3 `Picture`

- `ProbeStatus`: `ok` or `failed`.
- `ProbeError`: `null` on success, otherwise a sanitized, truncated error.
- `Width`, `Height`: positive integers or `null`.
- `Dpi`: positive number or `null`; the key is PascalCase and legacy `dpi` is forbidden.
- `BitDepth`: one positive integer or `null`. An EXIF `BitsPerSample` array/TypedArray collapses only when every channel is equal; differing or invalid values become `null`.

Probe failure does not remove the record. The gallery shows an image placeholder, the viewer reports the error, and customization remains editable.

### 9.4 `Video`

Canonical fields include:

- Status: `ProbeStatus`, `ProbeError`.
- Time and size: `DurationSeconds`, encoded `Width/Height`, `DisplayWidth/DisplayHeight`, `RotationDegrees`, `SampleAspectRatio`.
- Frame rate: `FrameRate`, `FrameRateRatio`.
- Video stream: `VideoCodec`, `VideoProfile`, `PixelFormat`, `BitDepth`, `BitRate`.
- Container and stream counts: `ContainerFormat`, `VideoStreamCount`, `AudioStreamCount`.
- Audio: `HasAudio`, `AudioCodec`, `AudioChannels`, `AudioSampleRate`, `AudioBitRate`.
- Color: `ColorSpace`, `ColorTransfer`, `ColorPrimaries`.

`ProbeStatus` is `ok` for a normalized primary video stream, `audio-only` for a parseable container without video, and `failed` for timeout, corruption, or parse failure. Missing strings/numbers are `null`; stream counts are non-negative integers and `HasAudio` is Boolean. Prefer a stream with `disposition.default = 1`, otherwise the first stream of that type.

### 9.5 `GPS` and `Camera`

`GPS` retains EXIF-style directions and DMS/rational arrays. Videos attempt to parse QuickTime ISO 6709. `GPS.AltitudeRef` preserves its parser-provided shape and is not edited, filtered, or calculated.

`Camera` stores make, model, focal length, aperture, ISO, exposure time, and flash state. `FlashUsed` is strictly tri-state: `true` means EXIF explicitly says flash fired, `false` means explicitly not fired, and `null` means absent or unreliable. Do not coerce unknown to false or treat every nonzero EXIF Flash code as true. The viewer displays yes, no, and `-`; CSV renders `null` as an empty cell. Videos usually expose only make/model and no reliable flash source, so video `FlashUsed` is currently `null` and video views omit the image-only camera table.

### 9.6 `Customization`

```json
{
  "Title": "",
  "AlbumId": null,
  "TagIds": [],
  "PersonIds": [],
  "Description": "",
  "HiddenDescription": "",
  "Rating": 2,
  "Privacy": 1,
  "MetadataUpdateDate": null
}
```

- `Title`, `Description`, `HiddenDescription`: free text.
- `Rating`: integer 1–5; JPG/JPEG and video default to 2, other images to 1.
- `Privacy`: integer 1–5, default 1. Level 1 is least restrictive/public; level 5 is most private; intermediate values have only numeric meaning.
- `AlbumId`: zero or one registered album ID; `null` means none.
- `TagIds`, `PersonIds`: arrays of registered IDs without duplicates.
- `MetadataUpdateDate`: ISO timestamp of the latest user-field update.

Exactly these nine fields must exist. Text values must be strings; rating/privacy must be valid integers; multi-value IDs cannot repeat; update date is `null` or canonical ISO. Obsolete `Category`, `PrivateNote`, or any unknown field makes strict loading fail. Main-process single and batch edit entry points accept only their editable-field allowlists, generate update timestamps themselves, and reject extra renderer properties.

Privacy is descriptive metadata, not access control. It participates in explicit gallery filtering, whose default selects only level 1, but does not restrict clipboard, system-open, or CSV export.

### 9.7 `Location`

```json
{"LocationId":"d9f1ea44-4eb8-4e5b-876c-6ae2e36d36e3","Detail":"fourth-floor pizza station"}
```

- `LocationId`: zero or one registered location ID; `null` means no primary location.
- `Detail`: free-text detail, outside the registry and excluded from location filtering/search.

Only `LocationId` and `Detail` are allowed. Administrative fields belong solely to the location registry and must not be redundantly persisted per media.

## 10. Registry Models

Registry definitions store stable IDs and readable names. Media persist only ID references; the renderer resolves current display names. IDs are hidden in ordinary UI but appear in JSON, CSV, and diagnostics. Each registry permits only its fixed persisted fields; UI-derived and legacy fields are forbidden. The main process enforces these constraints even if the UI is bypassed.

IDs are immutable while names/descriptions may change. Renaming atomically updates only the registry's display fields, description, and `UpdatedAt`, preserving ID and `CreatedAt` without rewriting media. Filters, recent choices, batch drafts, and media references therefore remain selected and resolve the new name. Registry IDs and `MediaId` share one global UUID namespace.

### 10.1 Tags

```json
{"TagId":"...","Text":"Food","Description":"","CreatedAt":"...","UpdatedAt":"..."}
```

- `Text` is non-empty and globally unique within the registry.
- `tag:update` atomically changes text and description.
- Description may be empty.
- Media may have multiple tags; removing one assignment does not delete its definition.
- Global deletion removes the ID from every `Customization.TagIds` array.

### 10.2 Albums

```json
{"AlbumId":"...","Title":"Camera","Description":"Camera captures","CreatedAt":"...","UpdatedAt":"..."}
```

- `Title` is globally unique within the registry and editable.
- Title and description are required at creation and must remain valid together; description cannot later be emptied.
- Media belongs to at most one album.
- Global deletion sets every exact `Customization.AlbumId` reference to `null`.
- Albums are categorization only; there is no cover or detail page.

### 10.3 People

```json
{"PersonId":"...","Name":"Alex","Description":"","CreatedAt":"...","UpdatedAt":"..."}
```

- `Name` is non-empty, unique within the registry, and editable.
- Description may be empty.
- Media may reference multiple people.
- Global deletion removes the ID from every `Customization.PersonIds` array.

### 10.4 Locations

```json
{
  "LocationId":"...",
  "Name":"Campus Dining Hall",
  "Country":"China",
  "Province":"",
  "City":"Beijing",
  "ParentId":"...",
  "Description":"",
  "CreatedAt":"...",
  "UpdatedAt":"..."
}
```

- `LocationId` is the stable key; `Name` is only display text.
- Names may repeat across different administrative or parent contexts. Only an identical `(Name, Country, Province, City, ParentId)` is a duplicate.
- Renaming preserves IDs, media references, and child `ParentId` values; descendant paths are recomputed from the ID chain.
- `Country`, `Province`, `City`, and `Description` may be empty; `ParentId` may be `null`.
- Country/province/city are attributes, not registry nodes. To assign “Nanjing” itself, create an ordinary location named Nanjing.
- `ParentId` references at most one registered location and cannot reference self or form a cycle.
- Never persist `ChildrenIds`; derive children, depth, and paths from `ParentId`. Depth is unlimited.
- Deleting a location resets exact media assignments to `{LocationId:null, Detail:""}` and detaches direct children by setting their `ParentId` to `null`; it does not recursively delete descendants.
- Filtering by a location includes it and all descendants, but not ancestors, siblings, or `Detail`.

Location lists group by country, province, and city, then use parent-first depth-first order within each administrative group. Empty-province city groups precede non-empty provinces. A complete subtree must immediately follow its parent and cannot be interrupted by similarly named unrelated locations.

## 11. Scanning and Incremental Updates

Initialization fully hashes every medium, reads image EXIF/Sharp data, and probes video with FFprobe. New videos default to rating 2.

An update reuses an entire same-path record without hashing or probing only when `FilePath`, `FileType`, `FileSize`, and `ModificationTimeMs` match. Existing data must already satisfy the current strict schema.

- A changed same-path file is rebuilt while preserving `Customization` and `Location`.
- A new path is fully hashed. If its hash matches one vanished old path, it is a move/rename: retain `MediaId`, technical/user data, and refresh path/filesystem data.
- If the matching old path still exists, the new file is a copy: create a new `MediaId` and default user fields.
- Multiple candidates are paired one-to-one in stable path order.
- A temporary rebuild failure retains the same-path old record; a failed new record is skipped and reported.
- Removed records are deleted, along with hash thumbnails unused by any remaining record.

Duplicate hashes are valid and logged. Operations needing one source choose the first stable path.

## 12. Thumbnail Pipeline

Thumbnails are `.photo_manager/thumb_cache/<SHA256Hash>.webp`, shared by equal content. `cache_manifest.json` stores size, quality, extreme-aspect threshold, and generator version; mismatches make the cache stale.

Ordinary images are center-cropped square; extremely tall images crop from the top and extremely wide images from the left. Videos extract a PNG frame and pass it through Sharp. Target time is `min(max(DurationSeconds * 0.1, 1), 10, DurationSeconds / 2)`; failure retries frame zero, then uses the video placeholder. Failed images use the image placeholder. Video workers default to serial; image concurrency is configured.

Only an explicit maintenance action or `build-thumbnails` generates thumbnails. Opening, initialization, and metadata updates do not. Missing/damaged cache entries use bundled placeholders, never original media. The main process indexes thumbnail filenames once per active cache state and supplies a shared URL version; closing/switching, updates, and thumbnail maintenance invalidate it. The renderer requeries after generation.

## 13. Video Playback

The main `<video preload="metadata">` has no native controls; `VideoPlaybackControls.vue` provides fixed play, time, timeline, mute, and volume controls. Poster is not autoplayed or looped. A center play control appears before play and while paused/ended, except during buffering, seeking, or stepping. Surface click is delayed 220 ms to distinguish double-click fullscreen, and dragging beyond threshold suppresses click. Seeking pauses and resumes only if previously playing.

Decode failure with known audio falls back to native `<audio controls>`; otherwise show an unplayable state, reason, poster/placeholder, and system-player action. Chromium-incompatible codecs use the Windows player. No proxy is generated and runtime errors are not persisted.

Only volume and mute persist (`photoManager.videoVolume`, `photoManager.videoMuted`). Position and rate do not. Before replacement/destruction, pause, remove `src`, and call `load()` to release sound and handles.

Before a video session begins, arrows browse media. After playback, seeking, or stepping begins it, arrows seek five seconds and Shift+arrows browse. Space toggles play; comma/period step approximately `1 / FrameRate`, disabled without frame rate. Editable/focused controls suppress shortcuts.

Images and decodable videos share temporary 10–1000% zoom, pan, quarter rotation, mirror, and restore. Wheel zoom anchors at the pointer; step is configured below 200%, 20 points through 500%, then 50. Other controls zoom around center. CSS-only transforms reset on media/viewer changes and never alter files, metadata, time, or thumbnails. Image EXIF dimensions and 88% fit remain respected. Videos fit normalized display dimensions, use full space at 100%, and compensate quarter turns. Drag threshold is 4 px. Fixed playback controls remain in media fullscreen; audio/error modes have no transforms.

## 14. Gallery Query and Filtering

`gallery:query` filters the in-memory index in this order: media type; unioned rating/privacy levels intersected with other dimensions; album/tag/person/location including `__UNASSIGNED__`; case-sensitive title, filename-only, or description substring; shooting-time order; capture-date grouping. Empty level arrays mean all; rating defaults all and privacy defaults `[1]`. Location includes descendants; administrative filters resolve exact country/province/city sets. Invalid regions are rejected. `Detail` never participates.

Every query returns the complete result and all/image/video counts, without registries or pagination. One metadata pass applies common filters/counts; matched records are enriched and sorted once. Renderer uses shallow collections, creates all cards, and relies on native `loading="lazy"`; future virtualization must preserve complete-result semantics. Increasing request IDs discard stale responses.

Registry composables exclusively own their lists. They load in parallel on open/update and update directly from registry IPC results. Media edits do not reload registries; manager opening refreshes usage counts. Returning from viewer records one `MediaId`, centers that card after layout, then clears the target.

One `GalleryMediaDetailsMenu` serves all cards and shows fixed metadata, constrained to the viewport. Outside interaction, scroll, resize, Escape, or repeated right-click closes it; detail, filters, and settings are mutually exclusive.

Select-all covers the full result. Batch edit can set title/rating/privacy/album/location and add people/tags. `null` rating/privacy means unchanged; level 1 is valid. Escape closes the foremost overlay before selection mode.

The always-visible search sits above a normally expanded two-row filter drawer that occupies layout space. Its expanded state survives viewer navigation but resets on library exit. A status dot compares against defaults: all media/registries/ratings, privacy 1, descending shooting time. Reset restores defaults and exits selection without changing drawer expansion.

Registry filters use read-only triggers with internal search. “All” and “Unassigned” precede complete options; location shows its tree. Rating/privacy use `All + 1..5` multi-select segments. Concrete location, administrative region, and unassigned location are mutually exclusive. Administrative paths distinguish identical names and exact empty provinces. `__UNASSIGNED__` is query-only and must never enter metadata, registries, recent history, or persistence.

## 15. Viewer and Customization Editing

The viewer has technical information left, media center, and shared customization right: title, rating, privacy, album, location/detail, people, tags, description, hidden description. Privacy, location detail, and hidden description are independently collapsible and retain state only within the current viewer instance.

A dirty draft requires Save and Continue, Discard, or Cancel before navigation. `Ctrl+Enter` confirms supported text fields; ordinary Enter preserves editing behavior and Escape blurs without discarding. Enter saves only when focus is not interactive. Submission locks prevent duplicate requests and edits.

Registry fields use read-only triggers, menu search, and separate create/manage buttons. Only one menu opens. `RegistryOptionsMenu.vue` owns shared flat-menu behavior; locations use `LocationTreeMenu.vue`. Tag/person/location assignment shows three library-UUID-scoped recent values; filters do not. Albums have no recent list.

## 16. Location Hierarchy Display

All location selectors, filters, parent selectors, and managers share `buildLocationHierarchyRows()`: country, province (empty first), city (direct-under-country cities keep city indentation), then stable root locations with complete parent-first subtrees.

`LocationTreeMenu.vue` renders pure selection; the manager uses the same rows but its own usage/edit layout. Country/province start expanded while concrete locations start hidden. Administrative and concrete expansion keys are separate; reopening resets them. Arrow and label hit areas are separate. Only the gallery filter may select administrative rows.

Search scans the full registry, adds every location ancestor, and reveals matching paths without changing manual expansion. Recent entries sit outside the tree. Parent selection excludes the edited node and descendants. Manager cards indent by depth and use a fixed context strip based on the first visible card. `Location.Detail` is excluded.

## 17. Registry Management

All four managers search name/description, show usage, atomically edit allowed fields, confirm global deletion with affected count, create through a nested modal, and block close/switch/resubmit during requests. Enter saves names; Ctrl+Enter saves multiline descriptions; Escape cancels editing.

Location create/edit shares the parent picker. Selecting a parent during creation copies its exact administrative fields, which remain editable; clearing it does not clear them. Changing parent while editing does not rewrite administrative fields. Main-process validation rechecks requirements, uniqueness/context duplication, parent existence, and cycles.

Rename refreshes only the registry and preserves IDs/media. Global deletion keeps the manager open and synchronizes definitions, filters, viewer, and gallery cache. If result membership is unchanged, referenced items are patched in place without replacing arrays/indexes; otherwise the gallery requeries.

## 18. Library Settings and Maintenance

The gallery settings menu, visible only in normal gallery mode, exposes library information/directories, metadata update, verification, thumbnail generation, CSV export, registry management, and return to entry.

`scripts/maintenance-worker.js` runs operations as child processes with structured progress, logs, and results. The UI shows phase/count/current path and supports copying reports or opening outputs/logs.

- Update: create an update backup, incrementally replace metadata, strictly reload indexes, and refresh without generating thumbnails.
- Verify: read-only rescan and full hashes; report missing metadata/files, changes, type mismatches, probe/read failures. Optional probe compares video status, duration, dimensions, and codec.
- Thumbnails: generate missing/stale or forcibly rebuild all, without editing metadata; then requery.
- CSV: fixed output at `.photo_manager/data/photo_metadata.csv`, overwrite confirmation, UTF-8 BOM, flattened user/technical fields, IDs plus resolved names, type-specific blank columns, and location ID/name/detail without duplicated administrative fields.

## 19. CLI Maintenance

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

## 20. IPC Contract

Request groups: `app:get-config`; `library:*` lifecycle, cancellation, directories, and info; `maintenance:start/show-output`; `gallery:query`; `photo:update-customization/batch-update`; list/create/update/delete-global for four registries; clipboard/system media actions; `photo:report-playback`; and `window:action/get-state`. Events are `library:state-changed`, `library:progress`, `maintenance:progress`, and `window:state-changed`.

Media IPC targets `mediaId`/`mediaIds`. Persisted IDs are PascalCase, mutation payloads camelCase, and each channel rejects unknown fields and obsolete PascalCase aliases. `FilePath` is never an action target: the main process resolves `MediaId` through its current index and verifies the resulting path remains inside the active library before any filesystem operation.

## 21. Source Responsibilities

### 21.1 `scripts/`

- `application-paths.js`: roaming/local paths and pre-ready Electron storage setup.
- `program-paths.js`: development/packaged program-resource root resolution and worker propagation contract.
- `application-config.js`: complete defaults and shared strict configuration loading.
- `library-core.js`, `library-access.js`, `library-lock.js`, `library-backup.js`, `library-transaction.js`: boundaries, authorization, locking, snapshots, atomic writes, transactions, and recovery.
- `operation-progress.js`, `maintenance-worker.js`: structured operation reporting and child-process dispatch.
- `common.js`, `library-data.js`: scanning, hashing, record creation, registry loading, and reference validation.
- `media-tools.js`, `media-time.js`, `thumbnail-cache.js`: FFmpeg execution/normalization, reference-time-zone logic, and thumbnail queues.
- `init-metadata.js`, `update-metadata.js`, `verify-metadata.js`, `build-thumbnails.js`, `export-metadata-csv.js`: maintenance operations.
- `start-electron.js`: sanitize the inherited environment and launch Electron.

### 21.2 `src/main/`

`main.js` is the composition root. `application-runtime.js` creates isolated runtime state; `application-state.js` handles atomic local state. Simple registry catalog/service modules share tag/person/album logic; location domain/catalog/service modules own hierarchy-specific behavior. `gallery-query.js` is pure filtering/counting/grouping; `gallery-item-enricher.js` adds renderer paths and cached thumbnail status. `metadata-edit-service.js` owns validated edits and rollback. `ipc-handlers.js` registers the allowlist without owning state; `window-manager.js` owns BrowserWindow lifecycle; `preload.js` is the only renderer bridge.

Shared schema modules enforce exact keys, UUID v4 identity, customization patches, global uniqueness, references, location contexts, and parent chains. Dependency direction is `main.js` assembly → IPC → domain services through explicit runtime accessors → `scripts/library-*` persistence. Domain modules never import the IPC registrar or window.

### 21.3 `src/renderer/`

The renderer is a declarative `App.vue` shell, application composition root, state-owning composables, pure domain functions, and presentation components. Components consume narrow contexts and never reverse-import the composition root. Pure functions import no Vue/DOM/Electron; composables import no page components and collaborate only through callbacks/refs wired at the root.

State owners are: library session; gallery query and stale-request suppression; full-result selection; viewer navigation/shortcuts; editor drafts/locks; media transform listeners/observer; video element lifecycle/preferences; one composable per registry; library-scoped recent history; window controls; and UI feedback. Every owner of a global listener, timer, observer, element, or IPC subscription exposes idempotent cleanup called on unmount.

Contexts are split into library, gallery, gallery-filter, viewer, settings, four registries, and UI feedback. Components render and forward intent. Shared picker/menu components retain their single-value, multi-value, filter, and hierarchy semantics.

Global CSS remains deliberate. `styles.css` alone imports tokens, library, base, gallery, viewer fields, registry controls, customization, viewer media, registry overlays, feedback, then responsive overrides. Keep tokens centralized, place rules with the DOM owner, preserve import order, and add a module only for a stable new visual responsibility.

For extensions: put deterministic algorithms in pure modules with `node:test`; give each state one lifecycle owner; coordinate cross-domain effects at the composition root; expose actions through the narrow existing context; use preload IPC only; use `shallowRef` for normalized full-result collections and separate edit drafts; verify listener cleanup during behavior-preserving refactors.

## 22. Tests and Acceptance

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

## 23. Development Invariants

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

## 24. Explicitly Out of Scope

- Database, cloud sync, multi-user or cross-process collaborative editing.
- Recent-library lists, nested libraries, symlink media, or external media references.
- Automatic filesystem monitoring.
- Album detail pages/covers or photo-group structures.
- Video proxy transcoding, subtitles, chapters, track switching, manual covers, remembered position, looping, screenshots, or exact variable-frame-rate indexing.
- In-application backup restoration.

## 25. Architecture Summary

PhotoManager combines application code and global settings with user-selected independent libraries whose management data are self-contained. The Electron main process owns the only active library session and all writes; maintenance tools share its boundary, lock, and persistence modules; Vue owns interaction and serializable UI state. A library can be moved or backed up together with `.photo_manager` and has no dependency on data paths inside the installation directory.
