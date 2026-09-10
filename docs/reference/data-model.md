# Media and Registry Data Model

Status: implemented application behavior. Part of the [project specification](../../PROJECT.md); browse the [documentation index](../README.md). Source paths in this reference are relative to the repository root.

Strict media schemas, capture-time semantics, UUID registries and location relationships.

## Media Metadata Model

Each line of `photo_metadata.jsonl` is one media record. Images and videos share the top-level structure and are distinguished by `FileSystem.FileType`.

### Top-Level Keys

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

### `FileSystem`

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

### `Picture`

- `ProbeStatus`: `ok` or `failed`.
- `ProbeError`: `null` on success, otherwise a sanitized, truncated error.
- `Width`, `Height`: positive integers or `null`.
- `Dpi`: positive number or `null`; the key is PascalCase and legacy `dpi` is forbidden.
- `BitDepth`: one positive integer or `null`. An EXIF `BitsPerSample` array/TypedArray collapses only when every channel is equal; differing or invalid values become `null`.

Probe failure does not remove the record. The gallery shows an image placeholder, the viewer reports the error, and customization remains editable.

### `Video`

Canonical fields include:

- Status: `ProbeStatus`, `ProbeError`.
- Time and size: `DurationSeconds`, encoded `Width/Height`, `DisplayWidth/DisplayHeight`, `RotationDegrees`, `SampleAspectRatio`.
- Frame rate: `FrameRate`, `FrameRateRatio`.
- Video stream: `VideoCodec`, `VideoProfile`, `PixelFormat`, `BitDepth`, `BitRate`.
- Container and stream counts: `ContainerFormat`, `VideoStreamCount`, `AudioStreamCount`.
- Audio: `HasAudio`, `AudioCodec`, `AudioChannels`, `AudioSampleRate`, `AudioBitRate`.
- Color: `ColorSpace`, `ColorTransfer`, `ColorPrimaries`.

`ProbeStatus` is `ok` for a normalized primary video stream, `audio-only` for a parseable container without video, and `failed` for timeout, corruption, or parse failure. Missing strings/numbers are `null`; stream counts are non-negative integers and `HasAudio` is Boolean. Prefer a stream with `disposition.default = 1`, otherwise the first stream of that type.

### `GPS` and `Camera`

`GPS` retains EXIF-style directions and DMS/rational arrays. Videos attempt to parse QuickTime ISO 6709. `GPS.AltitudeRef` preserves its parser-provided shape and is not edited, filtered, or calculated.

`Camera` stores make, model, focal length, aperture, ISO, exposure time, and flash state. `FlashUsed` is strictly tri-state: `true` means EXIF explicitly says flash fired, `false` means explicitly not fired, and `null` means absent or unreliable. Do not coerce unknown to false or treat every nonzero EXIF Flash code as true. The viewer displays yes, no, and `-`; CSV renders `null` as an empty cell. Videos usually expose only make/model and no reliable flash source, so video `FlashUsed` is currently `null` and video views omit the image-only camera table.

### `Customization`

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

### `Location`

```json
{"LocationId":"d9f1ea44-4eb8-4e5b-876c-6ae2e36d36e3","Detail":"fourth-floor pizza station"}
```

- `LocationId`: zero or one registered location ID; `null` means no primary location.
- `Detail`: free-text detail, outside the registry and excluded from location filtering/search.

Only `LocationId` and `Detail` are allowed. Administrative fields belong solely to the location registry and must not be redundantly persisted per media.

## Registry Models

Registry definitions store stable IDs and readable names. Media persist only ID references; the renderer resolves current display names. IDs are hidden in ordinary UI but appear in JSON, CSV, and diagnostics. Each registry permits only its fixed persisted fields; UI-derived and legacy fields are forbidden. The main process enforces these constraints even if the UI is bypassed.

IDs are immutable while names/descriptions may change. Renaming atomically updates only the registry's display fields, description, and `UpdatedAt`, preserving ID and `CreatedAt` without rewriting media. Filters, recent choices, batch drafts, and media references therefore remain selected and resolve the new name. Registry IDs and `MediaId` share one global UUID namespace.

### Tags

```json
{"TagId":"...","Text":"Food","Description":"","CreatedAt":"...","UpdatedAt":"..."}
```

- `Text` is non-empty and globally unique within the registry.
- `tag:update` atomically changes text and description.
- Description may be empty.
- Media may have multiple tags; removing one assignment does not delete its definition.
- Global deletion removes the ID from every `Customization.TagIds` array.

### Albums

```json
{"AlbumId":"...","Title":"Camera","Description":"Camera captures","CreatedAt":"...","UpdatedAt":"..."}
```

- `Title` is globally unique within the registry and editable.
- Title and description are required at creation and must remain valid together; description cannot later be emptied.
- Media belongs to at most one album.
- Global deletion sets every exact `Customization.AlbumId` reference to `null`.
- Albums are categorization only; there is no cover or detail page.

### People

```json
{"PersonId":"...","Name":"Alex","Description":"","CreatedAt":"...","UpdatedAt":"..."}
```

- `Name` is non-empty, unique within the registry, and editable.
- Description may be empty.
- Media may reference multiple people.
- Global deletion removes the ID from every `Customization.PersonIds` array.

### Locations

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
