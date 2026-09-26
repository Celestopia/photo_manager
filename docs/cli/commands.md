# CLI command reference

Every command takes `--library <folder>` and optionally `--format text|json|jsonl`. Use `ptmgr <group> <command> --help` to list supported options. Unknown flags, unsupported flags, and duplicate scalar flags fail.

## Library

| Command | Options and behavior |
| --- | --- |
| `library init` | `--name <name>`, `--yes`. Scan, hash, and initialize an ordinary folder. Confirmation required. Original media are unchanged. |
| `library info` | Show manifest, root, and media/registry counts. |
| `library rename` | `--name <name>`. Back up and change the display name. |
| `library recover` | `--yes`. Explicitly recover pending deletion/JSONL transactions under the exclusive lock. |
| `library unlock` | `--yes`. Remove a verifiably stale same-computer lock. Active, foreign-host, or unverifiable locks are not removed. |

## Media inspection and filters

`media show --id <MediaId>` returns the persisted record. `media list` returns matching records with deterministic gallery sorting and optional pagination.

| Option | Meaning |
| --- | --- |
| `--type image|video` | Media type; omit for all. |
| `--rating 1` through `--rating 5` | Repeat for several ratings. |
| `--privacy 1` through `--privacy 5` | Repeat for several levels; default includes all. |
| `--album`, `--tag`, `--person`, `--location` | Repeat UUIDs or `unassigned`. A location includes descendants. |
| `--album-name`, `--tag-name`, `--person-name`, `--location-name` | Exact names; repeat for multiple selections. Ambiguous names fail with candidates; use UUIDs to disambiguate. |
| `--country`, `--province`, `--city` | One administrative-region filter. |
| `--regions-file <file.json>` | Array of region objects with `level`, `country`, `province`, and `city`. Level is `country`, `province`, or `city`; use empty strings for unused fields. |
| `--search <text>` | Shared gallery search. |
| `--search-field title|filename|description` | Search field; default title. |
| `--order asc|desc` | Shooting-time order; default descending. |
| `--limit <number>`, `--offset <number>` | Nonnegative result window; default returns every match. |
| `--fields <comma-separated paths>` | Project fields, for example `MediaId,FilePath,Customization.Title`. |

Selections in the same field combine with OR; different fields combine with AND. Omit a registry filter for All. `unassigned` is a filter value, not an editable registry ID. Name lookup uses exact stored names; display search and sort follow shared gallery rules.

JSON output contains `total`, `returned`, and `items`; JSONL writes one record per line. Text mode uses a compact tab-separated summary. `--fields` uses persisted field names and retains dotted paths as output keys; absent type-specific fields are null.

## Media edits

Target one or more `--id <MediaId>` values, or `--ids-file <file.json>` containing a JSON array of UUIDs. Filters never implicitly select mutation targets. Use `--dry-run` for a preview and `--yes` to confirm batch edits in automation.

Scalar fields: `--title`, `--description`, `--hidden-description`, `--rating`, `--privacy`, `--detail`. Assign one `--album` or `--location` UUID. Repeat `--tag` and `--person` to replace those lists. Use `--add-tag`, `--remove-tag`, `--add-person`, and `--remove-person` for incremental list changes. Clear with `--clear-album`, `--clear-tags`, `--clear-people`, or `--clear-location` (also clears detail).

Use `--patch-file <file.json>` for Unicode, multiline text, or structured input:

```json
{
  "customization": { "Title": "A new title", "Rating": 4 },
  "location": { "Detail": "North entrance" },
  "addTagIds": ["00000000-0000-4000-8000-000000000001"]
}
```

The patch accepts only `customization`, `location`, `addTagIds`, `removeTagIds`, `addPersonIds`, and `removePersonIds`. Customization accepts `Title`, `Description`, `HiddenDescription`, `Rating`, `Privacy`, `AlbumId`, `TagIds`, and `PersonIds`. Location accepts `LocationId` and `Detail`. Null clears a single registry assignment; empty arrays clear lists. Omitted fields remain unchanged. IDs must already exist. UUIDs in examples are placeholders.

Patch and command flags may supply different fields but cannot supply the same field twice. Replacement and incremental changes cannot be combined for the same list; an ID cannot be both added and removed. All targets and references are validated before a single atomic metadata write. Unchanged records are skipped. Dry runs return before/after values without saving, backing up, or updating timestamps. Paths, hashes, GPS, capture time, technical fields, and metadata timestamps cannot be set by users.

## Registries

Use `registry <album|tag|person|location> <list|show|create|update|delete>`.

- `list`: definitions and usage information.
- `show --id <UUID>`: one definition.
- `create --name <text> [--description <text>]`: create a definition. Albums require a nonempty description, as in the GUI.
- `update --id <UUID>`: set `--name` and/or `--description`; omitted fields remain unchanged.
- `delete --id <UUID> [--dry-run] [--yes]`: remove globally and clear media references in a recoverable transaction. Confirmation required.

Location create/update also accepts `--country`, `--province`, `--city`, `--parent <LocationId>`, and `--clear-parent`. Hierarchy cycles and duplicate location contexts are rejected. Deleting a location detaches its direct children rather than deleting descendants; the preview includes affected media and detached-child counts. Registry mutations do not delete original media.

## Maintenance and export

| Command | Behavior |
| --- | --- |
| `maintenance update` | Incremental scan, hash/probe changed files, preserve matching identities and customization. No automatic thumbnails. |
| `maintenance verify [--probe]` | Rescan and full hash validation; optionally compare fresh video probes. Report without repairing metadata. |
| `maintenance thumbnails [--force]` | Generate missing/stale thumbnails; force regenerates all. |
| `maintenance video-covers [--force]` | Generate missing/invalid first-frame covers; force regenerates all. |
| `export csv [--output <path>] [--yes]` | Export UTF-8 BOM CSV with IDs, resolved names, and technical fields. Confirm overwriting. |

The default CSV output is `.photo_manager/data/photo_metadata.csv`. Custom output must be outside every library and cannot use symbolic links. `--force` controls regeneration only; it does not bypass locks or confirmations. Maintenance uses the same configured tools, cache recipes, backup rules, and processing functions as the GUI.
