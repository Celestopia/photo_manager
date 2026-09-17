# Media Processing and Playback

Scanning, incremental reuse, thumbnails, video playback and temporary transforms.

Part of the [project specification](../../PROJECT.md). See the [documentation index](../README.md) for related references. Source paths in prose are relative to the repository root.

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

Permanent media deletion removes a cached thumbnail only when no remaining metadata record uses its SHA-256 hash. It does not remove sidecars or empty source directories.

Ordinary images are center-cropped square; extremely tall images crop from the top and extremely wide images from the left. Videos extract the first decodable frame as PNG and pass it through the same Sharp thumbnail settings. Shared `video-first-frame.js` selects the default video stream, normalizes orientation and pixel aspect ratio, and performs no timestamp seeking. Black opening frames remain black; extraction failure uses the video placeholder without trying a later frame. Thumbnail extraction retains normalized source dimensions within the shared 64-megapixel decoding limit, independently of the cover cache and its 2560-pixel output limit. Failed images use the image placeholder. Video workers default to serial; image concurrency is configured.

The thumbnail generator version is 2. Missing or mismatched cache manifests require regeneration regardless of an unchecked force checkbox; explicit force also rebuilds the cache. The manifest covers images and videos together, so a recipe change rebuilds both at the next explicit thumbnail-generation operation. This invalidates disposable cache data without loading historical schemas or migrating library records. A successful run writes the current manifest; subsequent ordinary runs reuse thumbnails.

Only an explicit maintenance action or `build-thumbnails` generates thumbnails. Opening, initialization, and metadata updates do not. Missing/damaged cache entries use bundled placeholders, never original media. The main process indexes thumbnail filenames once per active cache state and supplies a shared URL version; closing/switching, updates, and thumbnail maintenance invalidate it. The renderer requeries after generation.

## Viewer Video Covers

In addition to viewer-triggered generation, **Generate Video Covers** and `build-video-covers` run the same recipe in the maintenance worker/CLI. They validate and reuse existing covers unless forced, process one source per unique hash sequentially, and can use another unchanged duplicate when one source is missing or changed. Shared source checks prevent batch and viewer behavior from diverging. See the maintenance reference for commands and reporting.

Viewer covers are independent of gallery thumbnails: `.photo_manager/video_covers/<SHA256Hash>.v1-2560-q90.webp`. Opening a video requests its cover by MediaId through sender-scoped IPC. The first decodable frame of the default video stream (or first video stream when no default exists) is retained even when black. FFmpeg applies orientation, then scales normalized display dimensions proportionally to at most 2560 pixels on the longest edge, without upscaling, and writes quality-90 WebP. Integer dimensions may introduce subpixel rounding. Non-square pixels are normalized to square pixels. HDR uses the existing FFmpeg color-conversion baseline; there is no dedicated tone mapping or HDR fidelity guarantee.

`video-cover-service.js` owns a serial per-window job with same-hash request sharing. Superseded requests cancel unnecessary work; close, maintenance and deletion abort and await extraction before changing sources or releasing the library lock. `video-cover-cache.js` validates decoded cache bytes, uses unique temporary files and atomic rename, and removes temporary files after failures. Decoding is limited to 64 megapixels, output to 2560 pixels per edge and 32 MiB, captured tool output to 1 MiB, and tool execution to configured probe/extraction timeouts. FFmpeg uses one decode/encode thread and a 256 MiB per-allocation limit; this is not a hard total process-memory cap.

Source size and modification time must match indexed metadata before reuse and publication; a mismatch leaves the placeholder until metadata is updated. Same-size, same-timestamp external changes are not detected. Paths reject symbolic links. No cover fields are persisted in media records. Equal hashes share covers across duplicate records and renames. Metadata updates and permanent deletion prune unreferenced video hashes and obsolete recipes; thumbnail maintenance leaves covers alone. Metadata backups exclude this disposable cache.

The renderer receives validated image bytes as a bounded data URL rather than a filesystem path; changed bytes avoid stale browser URL caching. A ready job is reused until cancelled; disk cache entries are decoded again on later requests. Failed covers are nonfatal, logged without source paths, and retried only on a subsequent selection. `use-video-cover.js` guards responses with request, media and library identity. While generating, the viewer displays its neutral placeholder. All initial/audio/error posters use the dedicated cover. Playback never waits: after play, seek or stepping starts, late results cannot change the video poster or recreate the MediaId-keyed element. Pause/end retain the decoded frame.

## Video Playback

The main `<video preload="metadata">` has no native controls; `VideoPlaybackControls.vue` provides fixed play, time, timeline, mute, and volume controls. Poster is not autoplayed or looped. A center play control appears before play and while paused/ended, except during buffering, seeking, or stepping. Surface click is delayed 220 ms to distinguish double-click fullscreen, and dragging beyond threshold suppresses click. Seeking pauses and resumes only if previously playing.

Decode failure with known audio falls back to native `<audio controls>`; otherwise show an unplayable state, reason, poster/placeholder, and system-player action. Chromium-incompatible codecs use the Windows player. No proxy is generated and runtime errors are not persisted.

Only volume and mute persist (`photoManager.videoVolume`, `photoManager.videoMuted`). Position and rate do not. Before replacement/destruction, pause, remove `src`, and call `load()` to release sound and handles.

Before a video session begins, arrows browse media. After playback, seeking, or stepping begins it, arrows seek five seconds and Shift+arrows browse. Space toggles play; comma/period step approximately `1 / FrameRate`, disabled without frame rate. Ordinary focused buttons allow horizontal viewer arrows, including navigation, toolbar, Information/Assistant and disclosure buttons. Text editors, numeric inputs, sliders, selects, native media controls, visible dialogs and interactive popups retain their own arrow handling. Composition, already-handled events and Ctrl/Alt/Meta-modified arrows do not navigate. Other shortcuts retain their focused-control restrictions, so Enter and Space still activate buttons normally.

Images and decodable videos share temporary 10–1000% zoom, pan, quarter rotation, mirror, and restore. Wheel zoom anchors at the pointer; step is configured below 200%, 20 points through 500%, then 50. Other controls zoom around center. CSS-only transforms reset on media/viewer changes and never alter files, metadata, time, or thumbnails. Image EXIF dimensions and 88% fit remain respected. Videos fit normalized display dimensions into 88% of the stage width and height at 100%, matching the photo viewer’s charcoal margins; quarter-turn compensation respects the same inset. Drag threshold is 4 px. Fixed playback controls remain in media fullscreen; audio/error modes have no transforms.
