# PhotoManager

PhotoManager is a local-first Windows desktop application for organizing image and video libraries. It uses Electron and Vue, keeps original media in place, and stores each library's metadata and supporting data beside that library.

See [PROJECT.md](PROJECT.md) for the complete architecture, data contracts, and interaction rules.

## Features

- Browse images and videos on one shooting-time timeline.
- Edit titles, ratings, privacy levels, descriptions, albums, tags, people, and hierarchical locations.
- Filter and batch-edit the complete matching media set.
- Play supported videos in the viewer and fall back to the Windows default player when necessary.
- Initialize, update, verify, generate thumbnails for, and export a library without a database or cloud service.

Supported images: JPG, JPEG, PNG, BMP, WebP, and GIF. Supported videos: MP4, MOV, MKV, and AVI.

## Install

Run the x64 NSIS installer on Windows 10 or 11. The installed application bundles Electron, FFmpeg, FFprobe, and all runtime dependencies; Node.js is not required. Application data remain in AppData, and libraries remain in their selected directories when PhotoManager is upgraded or uninstalled.

## Development

Development requires Node.js 20.19 or newer (or Node.js 22.12 or newer), npm, and Git LFS for the bundled FFmpeg executables.

```powershell
git lfs install
git lfs pull
npm install
npm start
```

`npm start` builds the renderer and launches Electron. FFmpeg and FFprobe are required to initialize or open a library; the bundled Windows x64 tools live under `tools/ffmpeg/bin/`.

Create an unpacked Windows application for smoke testing or an installable NSIS executable with:

```powershell
npm run pack:win
npm run dist:win
```

Both commands build the renderer first; `dist:win` also runs the complete test suite. Packaging output is written under `release/`.

On first use, select either an existing PhotoManager library or an ordinary directory to initialize. Initialization scans supported media, calculates hashes, extracts technical metadata, and creates the library management directory. It never modifies the original media files.

## Data Locations

Each library is self-contained:

```text
<library>\
  media files...
  .photo_manager\
    library.yml
    data\
    thumb_cache\
    backups\
    logs\
    temp\
```

The library can be moved as a unit. Libraries cannot be nested, and symbolic-link roots or media are not followed.

Application-wide data stay outside the installation directory:

```text
%APPDATA%\PhotoManager\
  app-data\config.yml
  electron\

%LOCALAPPDATA%\PhotoManager\
  app-data\state.json
  logs\
  session-data\
  crash-dumps\
```

The generated `config.yml` controls shared thumbnail, FFmpeg, backup-retention, and UI defaults. Relative FFmpeg paths are resolved from the installation directory. When updating from a release before v0.25.0, copy any customized root `config.yml` to the roaming path before first launch; per-library data are unaffected.

PhotoManager uses strict JSONL loading, atomic writes, backups, recoverable multi-file transactions, and an exclusive library lock. See [PROJECT.md](PROJECT.md) for the exact persisted schemas and safety rules.

## Maintenance Commands

Every standalone command requires an explicit library root. Close that library in the desktop application before running a command directly.

```powershell
npm run init-metadata -- --library "D:\Media\Example Library"
npm run update-metadata -- --library "D:\Media\Example Library"
npm run verify-metadata -- --library "D:\Media\Example Library"
npm run verify-metadata -- --library "D:\Media\Example Library" --probe
npm run build-thumbnails -- --library "D:\Media\Example Library"
npm run build-thumbnails -- --library "D:\Media\Example Library" --force
npm run export-metadata-csv -- --library "D:\Media\Example Library"
```

## Development Checks

```powershell
npm test
npm run build:renderer
git diff --check
```

For changed CommonJS files, also run `node --check <file>`. Metadata verification always requires an explicit test-library path.
