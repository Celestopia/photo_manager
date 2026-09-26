# Configuration and Data Locations

Roaming settings, machine-local state and the library directory layout.

Part of the [project specification](../../PROJECT.md). See the [documentation index](../README.md) for related references. Source paths in prose are relative to the repository root.

## Application Configuration and Library Data

### First Launch Without Installation

The unpacked release initializes its own user-data storage; no installer action or source-code environment is required. At process startup, `src/main/main.js` resolves the current account's `APPDATA` and `LOCALAPPDATA` paths and calls `configureElectronStoragePaths()` from `src/core/application-paths.js`. Before Electron becomes ready, that function recursively creates missing configuration, Electron user-data, local application-state, log, session-cache, and crash-dump directories under the respective `PhotoManager` roots, then assigns Electron's storage paths. Existing directories and data are retained.

During initialization, `loadConfig()` writes default `config.yml` when absent. Missing application state loads as an empty last-library selection; state and optional provider files are written when their owning operations require them, rather than all being pre-created. A new account can launch the complete unpacked folder and select or initialize a library directly. The account needs write access to AppData and the selected library. Unavailable environment paths or denied filesystem access prevent initialization rather than redirecting writes into the program folder.

The release is install-free, not a self-contained portable user profile. Moving the program folder on the same account retains access to that account's AppData; copying it to another device does not transfer settings or libraries. Deleting or replacing program files does not delete AppData or library-owned data.

### Application Configuration

`%APPDATA%\PhotoManager\app-data\config.yml` contains only application settings shared by every library and suitable for roaming with the user:

- `thumbnail`: dimensions, WebP quality, extreme-aspect threshold, and image concurrency.
- `media`: FFmpeg directory, probe timeout, extraction timeout, and video-thumbnail concurrency.
- `backup.retentionCount`: maximum retained backup snapshots per library, with a minimum of 1.
- `ui`: gallery card width, viewer panel ratios and default visibility, and zoom range.

`config.yml` does not contain library paths or data, thumbnail, or log directories. Individual libraries cannot override thumbnail or UI settings. The application directory contains only programs, dependencies, and program resources such as FFmpeg; it contains no live configuration or runtime state.

The application and standalone maintenance scripts use the same configuration module. When the file is absent, the caller creates its parent directory, writes the complete defaults, and continues. Invalid YAML is left untouched and defaults are used for that run. There is no runtime configuration UI; the renderer can only read normalized configuration.

Numeric normalization rejects non-finite values, uses integer dimensions/quality/concurrency/retention where required, and preserves valid fractional ratios. UI dimensions and zoom values remain positive, maximum zoom cannot be below minimum zoom, and visibility flags require booleans. Application loading and thumbnail workers share the same thumbnail defaults and normalization. Runtime fallback does not rewrite the user's configuration file.

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
    chat-provider.yml        # optional Assistant provider; created from its Settings menu
    search-provider.yml      # independent optional Tavily key and environment fallback
  logs\                     # startup diagnostics produced before a library opens
  session-data\             # localStorage, Chromium cache, and session state
  crash-dumps\
```

`state.json` contains only the last successfully opened library path. Because that path is machine-specific, it is not stored under roaming data. Video volume and mute plus the recent tags, people, and locations namespaced by library UUID remain in renderer `localStorage`, whose physical storage follows Electron `sessionData` into Local AppData. Cache and crash dumps must not pollute roaming data.

All windows share these paths because they live in one Electron coordinator process. The most recently completed library open wins `state.json`; writes are serialized and atomic. Provider-setting saves are also serialized, and other open windows receive a notice so a stale settings form can be reopened before editing. Window-scoped media, registry, chat-session, and maintenance state never enters these global files.

Before Electron becomes ready, the main process must create these directories and explicitly set `userData`, `sessionData`, `crashDumps`, and the log path. `src/core/application-paths.js` is the only shared source of global path rules for Electron and standalone CLI tools. Other modules must not reconstruct AppData paths.

The application does not maintain a recent-library list. Startup always shows the library-entry page. If a last successful path exists, its real name is read from `library.yml` and displayed with the full path, but the library is not loaded until the user chooses to enter it.

### Library Directory

A library is the selected media root. All Photo Manager data belonging to it must be inside:

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
    media-deletion.json          # exists only while media deletion needs recovery
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
    video_covers/                 # Lazy, disposable first-frame viewer covers.
      <SHA256Hash>.v1-2560-q90.webp
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
      media-deletions/
      temporary video-thumbnail files...
    chat/                    # conversations and imported attachments; excluded from automatic backups
```

`.photo_manager` is not given the Windows hidden attribute. The scanner excludes only this reserved directory at the library root; other ordinary hidden directories are still scanned.

Assistant configuration and its strict conversation/attachment records are documented in the [chat implementation](../agent/implementation.md) and [session storage](../agent/sessions.md) references. Chat uses the active library lock. Sessions live under `chat/`. Reviewed metadata changes share the existing recoverable transaction system with their session decision; tools never create registry entries.

Search settings use the exact YAML fields `schemaVersion: 1`, `provider: tavily`, `apiKey: ''`, and `apiKeyEnv: TAVILY_API_KEY`. They are machine-local and independent of the Assistant key. Web-off chat does not require this file. Settings opening can create defaults; saving and testing are explicit, serialized operations. Stored/environment keys never return to the renderer. A blank key preserves the saved value; explicit removal preserves the separate environment fallback. In-flight turns use a configuration snapshot; other windows are notified after saves. Globe permission is transient and is not global configuration.

### Online map requests

Leaflet code and styles are bundled locally. The only map tile endpoint is `https://tile.openstreetmap.org/{z}/{x}/{y}.png`; no key or new settings file is required. `src/main/map-network.js` registers one tile-domain header hook per Electron session, identifying Photo Manager and its version without altering unrelated requests. The only map attribution destination is `https://www.openstreetmap.org/copyright`, opened in the system browser.

Chromium manages HTTP tile caching within the existing Local AppData session-data directory; no map data are written into library metadata or the application directory. Server cache headers are respected, and only currently viewed tiles are requested. OSM availability is best-effort. See https://operations.osmfoundation.org/policies/tiles/ for attribution, identification, caching and usage requirements. Map loading exposes IP and the viewed tile area to the provider; original media, titles, descriptions and stored GPS records are not uploaded.
