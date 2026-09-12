# Interface and Editing

Gallery queries, selection, viewer drafts, location hierarchy and registry management.

Part of the [project specification](../../PROJECT.md). See the [documentation index](../README.md) for related references. Source paths in prose are relative to the repository root.

## Gallery Query and Filtering

`gallery:query` filters the in-memory index in this order: media type; unioned rating/privacy levels intersected with other dimensions; album/tag/person/location including `__UNASSIGNED__`; case-sensitive title, filename-only, or description substring; shooting-time order; capture-date grouping. Empty level arrays mean all; rating defaults all and privacy defaults `[1]`. Location includes descendants; administrative filters resolve exact country/province/city sets. Invalid regions are rejected. `Detail` never participates.

Every query returns the complete result and all/image/video counts, without registries or pagination. One metadata pass applies common filters/counts; matched records are enriched and sorted once. Renderer uses shallow collections, creates all cards, and relies on native `loading="lazy"`; future virtualization must preserve complete-result semantics. Increasing request IDs discard stale responses.

Registry composables exclusively own their lists. They load in parallel on open/update and update directly from registry IPC results. Media edits do not reload registries; manager opening refreshes usage counts. Returning from viewer records one `MediaId`, centers that card after layout, then clears the target.

One `GalleryMediaDetailsMenu` serves all cards and shows fixed metadata, constrained to the viewport. Outside interaction, scroll, resize, Escape, or repeated right-click closes it; detail, filters, and settings are mutually exclusive.

Select-all covers the full result. Batch edit can set title/rating/privacy/album/location and add people/tags. `null` rating/privacy means unchanged; level 1 is valid. Escape closes the foremost overlay before selection mode.

The always-visible search sits above a normally expanded two-row filter drawer that occupies layout space. Its expanded state survives viewer navigation but resets on library exit. A status dot compares against defaults: all media/registries/ratings, privacy 1, descending shooting time. Reset restores defaults and exits selection without changing drawer expansion.

Registry filters use read-only triggers with internal search. “All” and “Unassigned” precede complete options; location shows its tree. Rating/privacy use `All + 1..5` multi-select segments. Concrete location, administrative region, and unassigned location are mutually exclusive. Administrative paths distinguish identical names and exact empty provinces. `__UNASSIGNED__` is query-only and must never enter metadata, registries, recent history, or persistence.

## Viewer and Customization Editing

The viewer has technical information left, media center, and shared customization right: title, rating, privacy, album, location/detail, people, tags, description, hidden description. Privacy, location detail, and hidden description are independently collapsible and retain state only within the current viewer instance.

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

Copy File is available for images and videos. It validates the indexed source path and places a Windows CF_HDROP file reference and Preferred DropEffect=copy on the clipboard through a hidden STA Windows PowerShell/Windows Forms helper. Only the path is passed over stdin; source bytes are not read, decoded or converted. The receiver reads the original file when pasted, so the source must remain available. Copy File Path remains a separate text action. There is no pixel-copy action.

The gallery filter and sorting panel expands downward beneath the always-visible search bar. It starts expanded and uses a bottom-center chevron to collapse upward; the collapsed tab retains the modified-filter indicator. Toggling closes transient dropdowns without clearing filters, sort order or selection. The gallery uses the freed vertical space. Transitions respect reduced-motion preferences.

The batch-edit panel shows the selected item count and summed file size from the complete gallery selection. Its header uses an accessible X close button; compact bold Clear and Apply buttons retain their full action descriptions as tooltips. A red bin at the panel's lower right opens permanent deletion confirmation for the complete selection.

The gallery header places a three-line Settings button and Reset gallery icon at the left, followed by the application icon and PhotoManager name. Settings opens downward with a viewport-constrained scrollable menu. Gallery has no footer. Selected cards use a strong blue outline with a white inset and a blue circular check at the top right; video frame-rate badges move left in selection mode.

The viewer footer places permanent deletion at the far left as a red bin. Its shared confirmation names a single file or reports batch count and size, warns that media files are not contained in metadata backups, and notes when unsaved viewer customization will be discarded. A successful viewer deletion opens the next result, then the previous result if no next result remains, and otherwise returns to the gallery. Chat history is preserved even though references to deleted sources become unavailable.
