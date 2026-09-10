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
