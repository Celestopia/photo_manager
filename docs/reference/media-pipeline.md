# Media Processing and Playback

Status: implemented application behavior. Part of the [project specification](../../PROJECT.md); browse the [documentation index](../README.md). Source paths in this reference are relative to the repository root.

Scanning, incremental reuse, thumbnails, live playback and temporary transforms.

## Scanning and Incremental Updates

Initialization fully hashes every medium, reads image EXIF/Sharp data, and probes video with FFprobe. New videos default to rating 2.

An update reuses an entire same-path record without hashing or probing only when `FilePath`, `FileType`, `FileSize`, and `ModificationTimeMs` match. Existing data must already satisfy the current strict schema.

- A changed same-path file is rebuilt while preserving `Customization` and `Location`.
- A new path is fully hashed. If its hash matches one vanished old path, it is a move/rename: retain `MediaId`, technical/user data, and refresh path/filesystem data.
- If the matching old path still exists, the new file is a copy: create a new `MediaId` and default user fields.
- Multiple candidates are paired one-to-one in stable path order.
- A temporary rebuild failure retains the same-path old record; a failed new record is skipped and reported.
- Removed records are deleted, along with hash thumbnails unused by any remaining record.

Duplicate hashes are valid and logged. Operations needing one source choose the first stable path.

## Thumbnail Pipeline

Thumbnails are `.photo_manager/thumb_cache/<SHA256Hash>.webp`, shared by equal content. `cache_manifest.json` stores size, quality, extreme-aspect threshold, and generator version; mismatches make the cache stale.

Ordinary images are center-cropped square; extremely tall images crop from the top and extremely wide images from the left. Videos extract a PNG frame and pass it through Sharp. Target time is `min(max(DurationSeconds * 0.1, 1), 10, DurationSeconds / 2)`; failure retries frame zero, then uses the video placeholder. Failed images use the image placeholder. Video workers default to serial; image concurrency is configured.

Only an explicit maintenance action or `build-thumbnails` generates thumbnails. Opening, initialization, and metadata updates do not. Missing/damaged cache entries use bundled placeholders, never original media. The main process indexes thumbnail filenames once per active cache state and supplies a shared URL version; closing/switching, updates, and thumbnail maintenance invalidate it. The renderer requeries after generation.

## Video Playback

The main `<video preload="metadata">` has no native controls; `VideoPlaybackControls.vue` provides fixed play, time, timeline, mute, and volume controls. Poster is not autoplayed or looped. A center play control appears before play and while paused/ended, except during buffering, seeking, or stepping. Surface click is delayed 220 ms to distinguish double-click fullscreen, and dragging beyond threshold suppresses click. Seeking pauses and resumes only if previously playing.

Decode failure with known audio falls back to native `<audio controls>`; otherwise show an unplayable state, reason, poster/placeholder, and system-player action. Chromium-incompatible codecs use the Windows player. No proxy is generated and runtime errors are not persisted.

Only volume and mute persist (`photoManager.videoVolume`, `photoManager.videoMuted`). Position and rate do not. Before replacement/destruction, pause, remove `src`, and call `load()` to release sound and handles.

Before a video session begins, arrows browse media. After playback, seeking, or stepping begins it, arrows seek five seconds and Shift+arrows browse. Space toggles play; comma/period step approximately `1 / FrameRate`, disabled without frame rate. Editable/focused controls suppress shortcuts.

Images and decodable videos share temporary 10–1000% zoom, pan, quarter rotation, mirror, and restore. Wheel zoom anchors at the pointer; step is configured below 200%, 20 points through 500%, then 50. Other controls zoom around center. CSS-only transforms reset on media/viewer changes and never alter files, metadata, time, or thumbnails. Image EXIF dimensions and 88% fit remain respected. Videos fit normalized display dimensions, use full space at 100%, and compensate quarter turns. Drag threshold is 4 px. Fixed playback controls remain in media fullscreen; audio/error modes have no transforms.
