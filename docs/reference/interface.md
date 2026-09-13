# Interface and Editing

Gallery queries, selection, viewer drafts, location hierarchy and registry management.

Part of the [project specification](../../PROJECT.md). See the [documentation index](../README.md) for related references. Source paths in prose are relative to the repository root.

## Gallery Query and Filtering

`gallery:query` filters the in-memory index in this order: media type; unioned rating/privacy levels intersected with other dimensions; album/tag/person/location including `__UNASSIGNED__`; case-sensitive title, filename-only, or description substring; shooting-time order; capture-date grouping. Empty level arrays mean all; rating defaults all and privacy defaults `[1]`. Location includes descendants; administrative filters resolve exact country/province/city sets. Invalid regions are rejected. `Detail` never participates.

Every query returns the complete result and all/image/video counts, without registries or pagination. One metadata pass applies common filters/counts; matched records are enriched and sorted once. Renderer uses shallow collections, creates all cards, and relies on native `loading="lazy"`; future virtualization must preserve complete-result semantics. Increasing request IDs discard stale responses.

Registry composables exclusively own their lists. They load in parallel on open/update and update directly from registry IPC results. Media edits do not reload registries; manager opening refreshes usage counts. Returning from viewer records one `MediaId`, centers that card after layout, then clears the target.

One `GalleryMediaDetailsMenu` serves all cards and shows fixed metadata, constrained to the viewport. Outside interaction, scroll, resize, Escape, or repeated right-click closes it; detail, filters, and settings are mutually exclusive.

Select-all covers the full result. Batch edit can set title/rating/privacy/album/location and add people/tags. `null` rating/privacy means unchanged; level 1 is valid. Escape closes the foremost overlay before selection mode.

Search, filters, and sorting share one normally expanded three-row controller drawer that occupies layout space. The centered top row contains the search field, text input, and Search action; registry filters and sorting occupy the middle row, while media type, rating, and privacy occupy the bottom row. Its expanded state survives viewer navigation but resets on library exit. A status dot compares against defaults: empty search, all media/registries/ratings, privacy 1, and descending shooting time. Reset restores defaults and exits selection without changing drawer expansion.

Registry filters use read-only triggers with internal search. “All” and “Unassigned” precede complete options; location shows its tree. Rating/privacy use `All + 1..5` multi-select segments. Concrete location, administrative region, and unassigned location are mutually exclusive. Administrative paths distinguish identical names and exact empty provinces. `__UNASSIGNED__` is query-only and must never enter metadata, registries, recent history, or persistence.

## Viewer and Customization Editing

The viewer has technical information left, media center, and shared customization right: title, rating, privacy, album, location/detail, people, tags, description, hidden description. The side borders are pointer-draggable and use viewer-session pixel widths after initialization from the configured `1:3:1` panel ratio. Left, center, and right retain minimum widths of 220, 420, and 300 pixels where the supported window size permits; either side is capped at 45% of the viewer width. Dragging a side border below 96 pixels collapses that panel immediately. A tall inward chevron at the corresponding upper application edge restores its configured default width. Panel widths and visibility survive media changes made inside one viewer session. Returning to the gallery ends that session, so opening any media afterward restores the configured default widths and visibility. Hiding the right side preserves the active Metadata or Assistant view and does not stop an Assistant response during the current session. The footer has no side-panel toggles. Privacy, location detail, and hidden description are independently collapsible and retain state only within the current viewer instance.

A dirty draft requires Save and Continue, Discard, or Cancel before navigation. `Ctrl+Enter` confirms supported text fields; ordinary Enter preserves editing behavior and Escape blurs without discarding. Enter saves only when focus is not interactive. Submission locks prevent duplicate requests and edits.

Registry fields use read-only triggers, menu search, and separate create/manage buttons. Only one menu opens. `RegistryOptionsMenu.vue` owns shared flat-menu behavior; locations use `LocationTreeMenu.vue`. Tag/person/location assignment shows three library-UUID-scoped recent values; filters do not. Albums have no recent list.

## Location Hierarchy Display

All location selectors, filters, parent selectors, and managers share `buildLocationHierarchyRows()`: country, province (empty first), city (direct-under-country cities keep city indentation), then stable root locations with complete parent-first subtrees.

`LocationTreeMenu.vue` renders pure selection; the manager uses the same rows but its own usage/edit layout. Country/province start expanded while concrete locations start hidden. Administrative and concrete expansion keys are separate; reopening resets them. Arrow and label hit areas are separate. Only the gallery filter may select administrative rows.

Search scans the full registry, adds every location ancestor, and reveals matching paths without changing manual expansion. Recent entries sit outside the tree. Parent selection excludes the edited node and descendants. Manager cards indent by depth and use a fixed context strip based on the first visible card. `Location.Detail` is excluded.

## Registry Management

All four managers search name/description, show usage, atomically edit allowed fields, confirm global deletion with affected count, create through a nested modal, and block close/switch/resubmit during requests. Enter saves names; Ctrl+Enter saves multiline descriptions; Escape cancels editing.

Location create/edit shares the parent picker. Selecting a parent during creation copies its exact administrative fields, which remain editable; clearing it does not clear them. Changing parent while editing does not rewrite administrative fields. Main-process validation rechecks requirements, uniqueness/context duplication, parent existence, and cycles.

Rename refreshes only the registry and preserves IDs/media. Global deletion keeps the manager open and synchronizes definitions, filters, viewer, and gallery cache. If result membership is unchanged, referenced items are patched in place without replacing arrays/indexes; otherwise the gallery requeries.

## Modal Backdrops

Application modal dialogs dim and blur the content behind them while keeping their own content sharp. The shared `--modal-backdrop-blur` token in `tokens.css` is 3px, matching Assistant provider settings. The registry overlay styles apply it to library information, initialization, maintenance, registry managers, nested registry creation and viewer unsaved-change confirmation. Provider settings uses the same token on its native HTML dialog backdrop.

A nested creation dialog blurs the manager behind it; the library beneath both layers can receive both blur passes. Keep the existing dimming and stacking order. Anchored menus, dropdowns and tooltips do not blur the surrounding workspace. Windows-native dialogs remain controlled by the operating system.

Copy File is available for images and videos, and Batch Operation can copy the complete gallery selection in current display order. The main process validates every indexed source before replacing the clipboard, then places one or more Windows CF_HDROP file references and Preferred DropEffect=copy on the clipboard through a hidden STA Windows PowerShell/Windows Forms helper. Only paths are passed over stdin; source bytes are not read, decoded or converted. The receiver reads the original files when pasted, so every source must remain available. If any selected source is unavailable, the whole batch fails and the existing clipboard remains unchanged. Copy File Path remains a separate text action. There is no pixel-copy action.

The gallery search, filter, and sorting panel expands downward beneath the header. It starts expanded and uses a bottom-center chevron to collapse upward; all three controller rows collapse together, and the collapsed tab retains the modified-control indicator, including for nonempty search text. Toggling closes transient dropdowns without clearing search, filters, sort order, or selection. The gallery uses the freed vertical space. Transitions respect reduced-motion preferences.

The Batch Operation panel is opened from a wide, flat Batch operation button at the right of the gallery header. Directly below the panel title, a left-aligned icon row contains Explorer-compatible Copy and a selection toggle; the item count and summed file size appear on the following line. The toggle selects the complete result by default, highlights when every result is selected, and clears the selection when pressed again. Its header uses an accessible X close button to exit selection mode; compact bold Clear and Apply buttons retain their full action descriptions as tooltips. The red permanent-delete bin remains pinned at the lower right. Copy keeps the selection and panel open so the same set can be pasted or reused.

The gallery header places a three-line Settings button and Reset gallery icon at the left, centers the application icon and PhotoManager name as one brand unit independently of the side controls, and keeps Batch operation plus window controls at the right. Settings opens downward with a viewport-constrained scrollable menu. Gallery has no footer. Selected cards use a strong blue outline with a white inset and a blue circular check at the top right; video frame-rate badges move left in selection mode.

The viewer footer places permanent deletion at the far left as a red bin. Its shared confirmation names a single file or reports batch count and size, warns that media files are not contained in metadata backups, and notes when unsaved viewer customization will be discarded. A successful viewer deletion opens the next result, then the previous result if no next result remains, and otherwise returns to the gallery. Chat history is preserved even though references to deleted sources become unavailable.
