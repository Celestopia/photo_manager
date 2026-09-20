# PhotoManager

PhotoManager is a local-first Windows desktop application for organizing image and video libraries. It uses Electron and Vue, keeps original media in place, and stores each library's metadata and supporting data beside that library.

See [PROJECT.md](PROJECT.md) for the architecture entry point and links to detailed data contracts and interaction rules. The [documentation index](docs/README.md) lists the maintained references.

## Features

- Browse images and videos on one shooting-time timeline.
- Edit titles, ratings, privacy levels, descriptions, albums, tags, people, and hierarchical locations.
- Filter, batch-copy, and batch-edit the complete matching media set.
- Search photos and videos by meaning through the gallery Assistant, using local visual and metadata embeddings. Results respect gallery filters; temporary conversations are never saved. Choose 1–100 results (default 10). See [Semantic retrieval](docs/reference/retrieval.md).
- Permanently delete one media item from the viewer or a selected batch from the gallery, removing both files and metadata after confirmation.
- Play supported videos in the viewer and fall back to the Windows default player when necessary.
- Preview videos with uncropped first-frame covers, generated locally on demand and cached inside the library; gallery thumbnails remain separate.
- Load photos and video covers through the same viewer image path; cached covers display independently of video preparation and remain visible until a playback frame is ready.
- Use **Generate Video Covers** in the gallery menu to prepare all indexed videos in advance; optionally regenerate existing covers.
- Video thumbnails also use the first frame. Run **Generate Thumbnails** to refresh an outdated cache; recipe changes automatically require a rebuild, even with the regeneration checkbox unchecked.
- Chat about viewer media with a configured remote or local model; save conversations and import image/text attachments.
- Enable optional Tavily web research, inspect cited sources, and review researched metadata suggestions before saving.
- Initialize, update, verify, generate thumbnails for, and export a library without a database or cloud service.
- Launch PhotoManager again to open another independent library window; the same library cannot be opened twice.

Supported images: JPG, JPEG, PNG, BMP, WebP, and GIF. Supported videos: MP4, MOV, MKV, and AVI.

Viewer Assistant shares the left sidebar with Information. Open the Provider settings gear in the Assistant header to configure your API base URL, key and model. Images default to optimized uploads, with an unchanged-original option; videos and animated GIFs use sampled frames without audio. Remote requests upload selected content and may incur charges. Viewer chat requires no local model download. See [Using Assistant](docs/agent/usage.md).

Configure Tavily separately in **Provider settings → Web search**, then use the composer globe to enable search for the current conversation. Search is off by default. Its connection test uses a generic public query and page; it sends no library content.

## Semantic Search

Open **Settings → Build Semantic Index**, explicitly download the local embedding models (about 278 MiB), or import a previously downloaded model folder, then start the build. This runs on the CPU and can take time, especially for videos. The model files are stored under `%LOCALAPPDATA%\PhotoManager\models`; the derived index is stored inside the library at `.photo_manager/semantic/`. Models are not bundled with the executable.

Configure the Assistant provider, open the gallery **Assistant**, and describe what you want, for example “sea scenery at Santa Cruz Beach.” The configured LLM interprets your conversation; embeddings and similarity ranking run locally. Library media, metadata documents and vectors are not sent to that provider by gallery search. Results are approximate closest matches, not exact rules. Unindexed media cannot appear. Videos are returned as whole items and open at the beginning without autoplay.

Index updates are **manual**. Editing metadata does not rebuild vectors; the previous vectors remain searchable. Open **Build Semantic Index** to see missing, partial or outdated coverage and update it. Hidden descriptions, file paths and ratings are not encoded. The Results control defaults to 10 whenever a library is opened; a number requested in chat cannot override it.

## Run on Windows

Keep the complete `release/win-unpacked/` folder together and double-click `PhotoManager.exe` on Windows 10 or 11 x64. No installation or Node.js is required; Electron, FFmpeg, FFprobe, and runtime dependencies are bundled. Do not copy the executable alone. You can move or rename the complete folder and create a Windows shortcut manually.

On first launch, PhotoManager automatically creates its data folders for the current Windows account:

- `%APPDATA%\PhotoManager`: general configuration and Electron user data.
- `%LOCALAPPDATA%\PhotoManager`: machine-specific settings, application state, logs, and caches.

No installer or manual folder creation is needed. Missing general configuration is initialized with defaults; optional Assistant and web-search settings are configured separately. The app needs write access to these folders. Library metadata remains inside each selected library's `.photo_manager` folder, not in AppData.

To update, close all PhotoManager windows and use the newly built folder. Settings remain in AppData and libraries remain in their selected directories; copying the application folder to another PC does not copy those settings or libraries. On a new account without existing PhotoManager data, the app starts with default settings and no previously selected library. Removing the application folder does not remove your AppData settings or library data.

## Development

Development requires Node.js 20.19 or newer (or Node.js 22.12 or newer), npm, and Git LFS for the bundled FFmpeg executables.

```powershell
git lfs install
git lfs pull
npm install
npm start
```

`npm start` builds the renderer and launches Electron. FFmpeg and FFprobe are required to initialize or open a library; the bundled Windows x64 tools live under `tools/ffmpeg/bin/`.

Build the click-to-run Windows application with:

```powershell
npm run pack:win
npm run dist:win
```

Both commands produce only `release/win-unpacked/`; `dist:win` also runs the complete test suite first. No installer is generated.

On first use, select either an existing PhotoManager library or an ordinary directory to initialize. Initialization scans supported media, calculates hashes, extracts technical metadata, and creates the library management directory. It never modifies the original media files.

Each application launch opens a new library-entry window in the existing PhotoManager process. Windows may manage different libraries concurrently. Every window owns one library session, and the library lock rejects attempts to open the same library in another window or maintenance process.

## Data Locations

Each library is self-contained:

```text
<library>\
  media files...
  .photo_manager\
    library.yml
    media-deletion.json          # only while a media deletion needs recovery
    data\
    thumb_cache\
    video_covers\
    semantic\              # manually built, disposable embeddings; excluded from automatic backups
    backups\
    logs\
    temp\
      media-deletions\
    chat\                  # saved conversations and imported attachments; excluded from automatic backups
```

The library can be moved as a unit. Libraries cannot be nested, and symbolic-link roots or media are not followed.

Application-wide data stay outside the application directory:

```text
%APPDATA%\PhotoManager\
  app-data\config.yml
  electron\

%LOCALAPPDATA%\PhotoManager\
  app-data\state.json
  app-data\chat-provider.yml
  logs\
  models\                 # explicitly downloaded/imported local embedding models
  session-data\
  crash-dumps\
```

The generated `config.yml` controls shared thumbnail, FFmpeg, backup-retention, and UI defaults. Relative FFmpeg paths are resolved from the application directory.

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
npm run build-semantic-index -- --library "D:\Media\Example Library"
npm run build-semantic-index -- --library "D:\Media\Example Library" --force
npm run export-metadata-csv -- --library "D:\Media\Example Library"
```

## Development Checks

```powershell
npm test
npm run build:renderer
git diff --check
```

For changed CommonJS files, also run `node --check <file>`. Metadata verification always requires an explicit test-library path.
