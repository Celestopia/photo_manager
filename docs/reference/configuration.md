# Configuration and Data Locations

Status: implemented application behavior. Part of the [project specification](../../PROJECT.md); browse the [documentation index](../README.md). Source paths in this reference are relative to the repository root.

Roaming configuration, machine-local state and the library directory layout.

## Application Configuration and Library Data

### Application Configuration

`%APPDATA%\PhotoManager\app-data\config.yml` contains only application settings shared by every library and suitable for roaming with the user:

- `thumbnail`: dimensions, WebP quality, extreme-aspect threshold, and image concurrency.
- `media`: FFmpeg directory, probe timeout, extraction timeout, and video-thumbnail concurrency.
- `backup.retentionCount`: maximum retained backup snapshots per library, with a minimum of 1.
- `ui`: gallery card width, viewer panel ratios and default visibility, and zoom range.

`config.yml` does not contain library paths or data, thumbnail, or log directories. Individual libraries cannot override thumbnail or UI settings. The installation directory contains only programs, dependencies, and program resources such as FFmpeg; it contains no live configuration or runtime state.

The application and standalone maintenance scripts use the same configuration module. When the file is absent, the caller creates its parent directory, writes the complete defaults, and continues. Invalid YAML is left untouched and defaults are used for that run. There is no runtime configuration UI; the renderer can only read normalized configuration.

An absolute `media.ffmpegDir` is used directly. A relative value is always resolved from the program-resource root, never from the relocated AppData configuration directory. In development that root is the project root; in an installed build it is Electron's `resources` directory.

### Private Application State

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

### Library Directory

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
