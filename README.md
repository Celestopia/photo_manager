# PhotoManager

PhotoManager is a local-first Windows desktop manager for mixed image and video libraries. It is built with Electron and Vue and keeps each library self-contained: media stay in the selected directory, while metadata, registries, thumbnails, logs, and backups live under that directory's `.photo_manager/` folder.

Detailed implementation contracts are documented in [PROJECT.md](PROJECT.md).

## Requirements

- Windows 10 or 11, x64
- Node.js and npm
- Git LFS, because the bundled FFmpeg executables are LFS objects

Supported media extensions:

- Images: JPG, JPEG, PNG, BMP, WebP, GIF
- Videos: MP4, MOV, MKV, AVI

## Install

Fetch the FFmpeg binaries and install Node dependencies:

```powershell
git lfs install
git lfs pull
npm install
```

The default FFmpeg 8.1.2 Windows x64 tools are stored in `tools/ffmpeg/bin/`. `config.yml` may point `media.ffmpegDir` to another absolute or project-relative directory containing fixed filenames `ffmpeg.exe` and `ffprobe.exe`.

## Start

```powershell
npm start
```

`npm start` builds the Vue renderer and launches Electron. If the shell has set `ELECTRON_RUN_AS_NODE`, the project launcher clears it automatically.

The application opens the last successfully used library when possible. Otherwise it shows the library entry page:

1. Select an existing library root to open it.
2. Select an ordinary directory to initialize a new library.
3. Review the scan warning and confirm initialization.
4. Wait while PhotoManager hashes and probes supported media. Initialization can be cancelled; incomplete management data are then removed.

FFmpeg and FFprobe are mandatory for opening or initializing a library. If validation fails, the entry page remains available and reports the tool error.

## Library Layout

PhotoManager never stores a selected library's data in the application source directory. A library has this layout:

```text
D:\Media\Example Library\
  photos and videos...
  .photo_manager\
    library.yml
    data\
      photo_metadata.jsonl
      tag_registry.jsonl
      album_registry.jsonl
      person_registry.jsonl
      location_registry.jsonl
      photo_metadata.csv       # after export
    thumb_cache\
    backups\
    logs\
    temp\
```

The library root can be moved as a unit. `library.yml` contains a UUID that identifies the library independently from its path. Libraries cannot be nested, drive roots cannot be libraries, and symbolic-link roots/media are not followed.

## Using the App

The gallery mixes images and videos on one shooting-time timeline. It supports media-type, album, tag, person, and hierarchical-location filters, plus text search and batch editing. Each query loads the complete matching metadata set, so selection and viewer navigation cover every result; thumbnail images still use native browser lazy loading to limit unnecessary decoding.

The viewer shares title, rating, privacy level, album, location, people, tags, description, and hidden-description fields across both media types. Privacy is an integer from 1 (lowest privacy requirement) to 5 (highest) and defaults to 1. Its controls are collapsed below rating by default and remain expanded or collapsed while browsing between media. Registry-backed fields must be selected from registered values; definitions can be created or managed from the field controls or the gallery settings menu.

Each media record has a stable lowercase UUID v4 `MediaId`. Album, tag, person, and location references also use registry UUIDs rather than display text. Moving or renaming a file inside one library preserves its `MediaId`; a coexisting duplicate or a file imported into another library receives a new one. `FilePath` remains the current relative location and SHA-256 remains the content fingerprint, so neither is treated as the record identity.

Selection mode can batch-set title, rating, privacy level, album, and primary location, and batch-add people and tags. Rating and privacy controls both use an unset draft state so opening the panel never changes existing metadata until a level is selected. Privacy is descriptive metadata only: every level remains visible in the local gallery and CSV export, and it does not restrict clipboard or system-open actions.

The gallery's bottom-right settings menu provides:

- Library information and directory shortcuts
- Incremental metadata update
- Read-only metadata verification
- Missing/stale or forced thumbnail generation
- CSV export
- Album, location, person, and tag management
- Exit the current library and return to the library entry page

Maintenance operations lock editing and library switching until completion. Reports can be copied, and logs can be opened from the result dialog.

## Video Behavior

Videos use a fixed in-app control bar over Electron's native video element, with play/pause, timeline, time, mute, and volume controls. Unsupported video decoding falls back to native audio-only playback when possible, then to the Windows default player. No proxy transcoding is performed.

- A new video does not autoplay.
- Click the video to play or pause; double-click the media area for fullscreen.
- Decodable videos share the image viewer's temporary pan, 10–1000% zoom, quarter-turn rotation, horizontal mirror, and restore controls. These visual transforms reset when media changes and never alter files or metadata.
- Before playback starts, `Left/Right` browses media.
- After playback, scrubbing, or frame stepping starts the playback session, `Left/Right` seeks 5 seconds even while paused; `Shift+Left/Right` browses media.
- `Space` toggles play/pause.
- `,` and `.` step approximately one frame backward/forward.
- Volume, mute, and playback rate persist; playback position does not.

## Command-Line Maintenance

Every script requires an explicit library root. No script reads a workspace path from `config.yml`.

```powershell
npm run init-metadata -- --library "D:\Media\Example Library"
npm run update-metadata -- --library "D:\Media\Example Library"
npm run verify-metadata -- --library "D:\Media\Example Library"
npm run verify-metadata -- --library "D:\Media\Example Library" --probe
npm run build-thumbnails -- --library "D:\Media\Example Library"
npm run build-thumbnails -- --library "D:\Media\Example Library" --force
npm run export-metadata-csv -- --library "D:\Media\Example Library"
```

`init-metadata` is only for a directory without `.photo_manager`. `update-metadata` incrementally reuses unchanged records and preserves user fields. `verify-metadata` recomputes complete SHA-256 hashes but never repairs data. `--probe` additionally reruns FFprobe. CSV defaults to `.photo_manager/data/photo_metadata.csv` and requires explicit overwrite confirmation in the UI.

Independent scripts acquire the same library lock as the desktop application. Close the library in PhotoManager before running them directly.

## Configuration

`config.yml` contains application-wide settings only:

- Thumbnail dimensions, quality, crop threshold, and concurrency
- FFmpeg path and timeouts
- Backup retention count per library
- Gallery and viewer UI defaults

Library paths and internal data directories are intentionally not configurable. Fixed filenames and the `.photo_manager` layout are part of the library contract.

## Data Safety

- JSONL is loaded strictly; invalid JSON, duplicate paths or globally duplicated IDs, unknown registry references, missing fixed fields/files, an invalid manifest, or a Privacy value outside integer levels 1-5 rejects the entire library.
- Individual files are written through temporary-file replacement.
- User data writes create automatic library backups first.
- Global registry deletion uses a recoverable multi-file transaction because it can change both a registry and media metadata.
- A library lock prevents concurrent writers.
- Corrupt images and videos remain editable records with explicit probe-failure state.

## Development Checks

```powershell
npm test
npm run build:renderer
node --check src/main/main.js
node --check src/main/preload.js
npm run verify-metadata -- --library "D:\Media\Example Library"
git diff --check
```

The automated suite covers library boundaries, strict JSONL, Privacy validation and editing, locks, backups, transaction rollback, FFmpeg integration, metadata normalization, incremental updates, CSV export, thumbnails, and video keyboard/frame behavior.
