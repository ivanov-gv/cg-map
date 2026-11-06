# Task: Internal layer editor

Status: in progress. Slices 1-6 are implemented with the gaps listed under Completed and remaining. Slice 7 is the
offline-first install, served from Pages and optionally over the LAN, without authentication.

## Goal and acceptance criteria

Build a separate internal app using the same map as the public app. An editor can change POI metadata and position,
create/delete POIs, correct building addresses and footprints, edit road/path vertices and metadata, and export a
reviewable changeset.

- **One source GeoJSON file = one editing mode**, enforced by [the component rule](../../apps/editor/AGENTS.md). Each
  file has its own switch in Choose what to edit; one switch may be active at a time. Clicking it again returns to
  Browse. Test fixtures are not source layers. Satellite is a separate viewing option, not an editing mode.
- Modes are exactly places.geojson, buildings.geojson, building-labels.geojson, roads.geojson, land.geojson,
  water.geojson, context-countries.geojson and transport-stops.geojson. Every command, form, drag and undo/redo
  operation can change only the active source file. Road/path kinds and POI categories are tool options or filters
  within their file, never extra modes.
- Switching mode cancels incomplete drawing/moving; staged inspector changes must be applied or explicitly discarded.
  Completed changes remain in the session. Escape cancels a tool without silently applying it.
- The dock contains a layers table, not a sample-object list. Select individual objects on the map.
- Moving a point, building or geometry vertex uses continuous left-button dragging or relative touch swipes anywhere on
  the map. Multiple gestures adjust one preview without jumping to the contact point. Releasing lets the editor inspect
  the result; only Apply records one undoable change. Cancel, Escape and mode switches discard the preview. An
  interrupted pointer gesture restores its starting preview position; other edits/export stay disabled while moving.
- Buildings mode also supports moving/inserting/removing footprint corners and translating the whole building. Polygon
  rings stay closed with at least three distinct corners and nonzero area; crossings and nonadjacent touching edges are
  rejected. Buildings mode never changes the address-label file. Address text and label-point movement require
  building-labels.geojson mode. Production validation checks holes and label containment across the working datasets; a
  repair in another file requires an explicit mode switch and transaction, never a hidden coupled edit.
- Review lists additions, modifications, and deletions with before/after values. Export never publishes automatically.
- Reuse public cartography, local assets, visibility rules and map interaction primitives. Preserve public map behavior,
  deployment prefixes and offline invariants. No editorial API or database exists today.
- A reload must not silently lose production work: save a draft locally, show save failures, and offer recovery/export.
  The HTML sketch keeps changes in memory only.

Affected owners: web experience (both apps and shared rendering), map data (editable sources, import/validation), shared
stewardship (changeset format), platform (builds, boundaries and verification). Backend is unaffected in the first
stages.

## Decisions

Everything below is a proposal unless explicitly described as current. The HTML sketch is a disposable interface draft,
not the new production app or a working source-data editor.

### Current layer inventory

Counts were read directly from this checkout's source files on 2026-11-05. These are source features, not tile
fragments. All paths below are relative to [data/sources](../../data/sources).

| File                      | Features | Geometry and contents                             | Current properties / editing implications                                                                                                                          |
| ------------------------- | -------: | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| buildings.geojson         |   25,213 | Polygon footprints                                | Only `kind: building`; no address, name, height or building-use metadata in this snapshot.                                                                         |
| building-labels.geojson   |    1,076 | Interior Point address labels                     | `addr:housenumber`, optional `addr:street`, `osm_id`, `footprintIndex`, `address_sources`; real `way/...` IDs on numbered buildings.                               |
| places.geojson            |    1,811 | Point directory / POIs                            | Stable `properties.id`, name, category, kind, source, visibilityLevel; optional translated name, address, hours, phone, website.                                   |
| roads.geojson             |   17,881 | LineString roads **and paths**                    | `kind`, optional name. Motorways through residential/service roads, footway, pedestrian, path, track, cycleway and steps share this file. No shared-node topology. |
| land.geojson              |      284 | 282 Polygon + 2 MultiPolygon                      | 277 parks, one country shape, six context countries; kind and optional name.                                                                                       |
| water.geojson             |    1,491 | 1,112 Polygon + one MultiPolygon + 378 LineString | Water bodies, a derived ocean fill and rivers; kind and optional name.                                                                                             |
| context-countries.geojson |        6 | Five Polygon + one MultiPolygon                   | Named surrounding-country outlines, also represented within land; preserved separately as source context.                                                          |
| transport-stops.geojson   |      719 | Point                                             | Upstream stopId/name and feature ID; separately dated ePodgorica data.                                                                                             |

The rendered vector basemap has four source layers: land, water, roads and buildings. POIs, building numbers and bus
stops are separate runtime GeoJSON overlays. Satellite is raster imagery. City labels are constructed in the browser;
selection highlights, location, route endpoints/results and live vehicles are view/session layers, not additional
editable source files. The GeoJSON under data/tests/fixtures is a test fixture, not another published map layer.

There is no separate paths, entrances, addresses, road junctions or building-metadata GeoJSON. POI categories (`food`,
`sights`, `shops`, `stay`, `essentials`) share places.geojson. POIs derived from OSM areas are still points here.
Buildings and their address labels are different datasets; selecting a footprint must join the label, not create an
unrelated POI. A standalone building label does not represent arbitrary metadata on its footprint.

Related inputs are not editable GeoJSON layers:

- [place-visibility-policy.json](../../data/sources/place-visibility-policy.json) generates editorial levels using
  reviewed overrides; [the shared level table](../../packages/contracts/place-visibility.json) defines zooms 12, 14, 15,
  16 and 17 for levels 1–5. An exported visibility edit must update the policy as well as its generated result.
- [transit-network.json](../../data/sources/transit-network.json) contains dated route patterns/stops/times, not road
  geometry or an editable timetable. Live bus positions and external routing responses are never editorial inputs.
- [data/imagery](../../data/imagery) holds the bounded satellite sample; it is reference imagery, not editable geometry.
- [data/artifacts](../../data/artifacts) contains the reviewed PMTiles release; it is a display artifact. Edit the
  original source features, never geometry read back from clipped or simplified vector tiles.

See [source provenance](../../data/PROVENANCE.md), [shared formats](../../packages/contracts/README.md), and
[licensing](../map-data/data-license.md). Existing source GeoJSON is already simplified/rounded; it is not the complete
upstream OSM dataset.

### Reusing the map without copying the application

The first production slice implements the local ES-module package
[packages/map-core](../../packages/map-core/README.md), consumed by apps/web, apps/core-demo and the apps/editor source
viewer. This is a repository package, not a remote plugin service or a new framework. Keep
[packages/contracts](../../packages/contracts/README.md) for shared formats, not rendering helpers.

```text
apps/web -------------------+--> packages/map-core --> MapLibre / PMTiles / local assets
apps/core-demo -------------+
apps/editor ----------------+
  | modes, tools, inspector, history, draft storage, changeset export
  +--> packages/contracts <--- data validation / changeset importer
```

The intended responsibility split is:

| Area              | Owns                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/map-core | Map lifecycle, common cartography and source/layer rendering, asset URL injection, camera/projection helpers, hit testing and selection highlights, satellite and POI rendering.   |
| apps/web          | Public search and categories, place cards, route planning, live transport, device-location workflow, offline downloads/service worker and app updates.                             |
| apps/editor       | Editable source bundle, filename-keyed mode registry and file guards, property forms, geometry tools, command history, local draft recovery, validation, change review and export. |

`apps/core-demo` is an intentionally small consumer that imports only the public map-core entry point. One map and a
grid of concept controls exercise cartography, camera/projection, satellite, POI visibility, hit testing, selection and
a replaceable GeoJSON overlay. It has no public-app or editor imports, search, storage or editing workflow. Build it
separately from the public artifact; test it at root and prefixed URLs. Every later core feature needs an independently
usable demo control and acceptance evidence. The single map avoids competing WebGL contexts.

Core has no application screens, editorial state or writes. Shared schemas/visibility policy/changeset formats stay in
packages/contracts; reviewed sources, provenance, import validation and rebuilds stay with data. Both applications pass
their own adapters and callbacks into core instead of importing each other's entry point.

Moved to map-core; the public app imports them directly and no compatibility entries remain in apps/web/src:

| Shared capability                     | Now in packages/map-core/src      | Boundary                                                                                                       |
| ------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Base cartography and building numbers | map-style.js                      | Injected glyph, label and archive URLs; no dependence on location.href.                                        |
| Satellite sources and visibility      | satellite.js                      | Imagery stays local and attribution visible; the app decides camera movement.                                  |
| POI display and visibility            | place-visibility.js, poi-icons.js | Consumes the shared levels; the editor overlay shows hidden/below-zoom POIs without changing published levels. |
| Map lifecycle / source setup          | map.js, places.js                 | One map instance, injected container, URLs, data adapter and callbacks; explicit teardown of handlers.         |

Still in apps/web and only candidates for later extraction, when the editor shows a need:

| Candidate                      | Existing code                                                     | Boundary                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Object hit testing / selection | apps/web/src/object-selection.js, map-taps.js, point-selection.js | Separate rendering and hit resolution from public cards, route endpoints and app state.                        |
| Reusable UI primitives         | selected parts of apps/web/src/interface.js and public/style.css  | Share dock tiles, focus/viewport helpers and tokens; keep public search/routes and editor forms in their apps. |

App-level state in app.js is not a library. Do not import app.js into the editor or fork its DOM/handlers. Routing, live
transport, public service worker updates and offline-download controls remain public-app features until the editor has a
demonstrated need. In particular, public auto-update reloads must not interrupt unsaved editing.

Editor tools can have small activate/deactivate/dispose hooks in the editor host. Roads and paths share the
roads.geojson mode and linear-geometry tool; their kind is a tool setting. All mutations pass through one command
dispatcher that checks the active filename, including every changed feature's before/after ownership. Inspector,
keyboard, geometry and history controls cannot each invent their own permission rule. The shared map package has no
knowledge of this command registry.

The shared runtime consumes published formats and adapters; it must not import data tools, backend internals, editor
commands or either application's DOM. The editor supplies source GeoJSON plus an overlay of local edits. Its base map
may use the same reviewed archive. Moved/deleted features need an original-feature mask or replacement source so the old
basemap feature does not remain visibly underneath the edit. When a file mode is active, selectable editing overlays
show all its features, including POIs below their public visibility zoom.

The public build does not currently ship full editable roads/buildings GeoJSON. The real editor viewer loads a local
reviewed source bundle with a base-hash manifest, assembled by data-owned tooling. Its version-1 manifest lives in
shared contracts and has producer/consumer integration coverage. Do not assume a source-download API already exists.
Build and host the editor separately; keep its editable source bundle out of the public app artifact.

Libraries and fonts have one source, packages/map-core/assets; imagery and the release archive come from data. Each
application's own build tool copies them into its artifact through the map-core build helpers. This is artifact
assembly, not duplicated maintained code. apps/editor and apps/core-demo are independent projects: each has its own
Makefile, tests/e2e and CI pipeline, and no internal artifact is added to the Pages upload. See
[independent projects](../system-architecture/architecture.md#independent-projects).

### Editing and export boundary

Start with local files and export; publishing remains a reviewed data operation. The editor is an offline-first app
installed from Pages or a local HTTPS server. Its data is already public, so it has nothing to protect at a host. No
auth service or placeholder write endpoints are part of this plan.

Propose a versioned changeset contract with base dataset SHA-256 values, per-layer operations, stable/source identity
where available, an expected before-feature fingerprint, and full before/after GeoJSON. Preserve unknown properties and
source/license fields. New local POIs use an explicitly local UUID namespace, never fabricated OSM IDs. A deletion is a
tombstone in the review package. Also offer materialized GeoJSON per changed layer for GIS inspection; do not silently
overwrite source files on export.

Roads, buildings, land and water mostly lack stable source IDs. For the first pinned-snapshot workflow, a reference can
be `(layer, base SHA-256, feature index, before fingerprint)`; it is revision-bound, never an upstream identity. Stop an
import if the snapshot/fingerprint differs. Before supporting refresh/rebase or long-lived corrections, decide and
implement source-ID recovery or an explicit local identity registry plus conflict handling. Existing OSM extraction
replaces snapshots and would otherwise erase local edits. Do not promise automatic conflation.

Building labels use recovered way IDs, but footprintIndex is tied to the buildings hash. First edit existing known
addresses only. Supporting metadata for any building, or adding an address to an unnumbered footprint, needs an explicit
building metadata/identity contract. Do not fabricate `address_sources` for local corrections; add a provenance-aware
correction model and validate the join. Footprint geometry changes must validate label containment and joins across
files. They may not silently alter building-labels.geojson. If the final working datasets are inconsistent,
export/import must report the affected files and require explicit corrections in their own modes before applying the
reviewed batch atomically. The sketch enforces only per-file ownership and simple footprint checks; the production
editor and importer implement the label join.

A data-owned importer validates changeset version, base hashes, allowed layer/property types, finite WGS84 coordinates,
unique identities, nonempty names, visibility policy, closed rings and label joins before writing anything. Producer
validation and editor/consumer tests change together. Writes must be staged so validation failure leaves reviewed inputs
intact. New corrections retain base attribution plus their own local origin; imported upstream facts and local
corrections remain distinguishable.

Then review updated counts, provenance/hashes and visibility overrides. POI-only changes follow the existing source
validation and web-build path; geometry edits require an intentional `make -C data build-data` and release review. A
road drawing changes the display map; it does not modify external car/foot routing or create a routable graph.

## Progress

### Reviewable implementation slices

Each slice should be a small PR with a usable preview and acceptance evidence. Export/import is part of the first useful
edit, not a final-stage integration project.

| Slice                                     | Visible result                                                                                                                                                                                                           | Acceptance / review checkpoint                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0. Interaction draft                      | Standalone schematic: dock modes, inspector, POI changes, line/building vertices, whole-building moves, address, history, change review and draft export.                                                                | Open the HTML directly. It uses fictional objects, has no basemap engine, and does not write repository sources.                                                               |
| 1. Shared map + core demo + editor viewer | Public app uses extracted cartography; core-only demo exercises each shared capability; editor shows the same real map, satellite and source overlays. Browse and source-file tiles work, with mutations still disabled. | Side-by-side visuals; public e2e/offline unchanged; editor source counts, hidden POIs, layer selection and URL-prefix smoke tests.                                             |
| 2. POI metadata round trip                | Edit name/details/category/visibility, review before/after, undo/redo, export and import on a pinned sample.                                                                                                             | Mode guards, invalid-input refusal, policy override round trip, preservation of unknown fields, mismatch rejection and draft recovery.                                         |
| 3. Complete POI tools                     | Move, create and delete; all source POIs discoverable regardless of published zoom.                                                                                                                                      | No mutation outside the active file; unique local IDs, undo restores deletes, no old-position ghost, exported GeoJSON matches the working view.                                |
| 4. Building addresses and footprints      | Edit addresses in building-labels.geojson and footprints in buildings.geojson; validate their join without hidden cross-file writes.                                                                                     | Establish the correction identity contract first; validate closed rings/topology, atomic label-anchor joins, before/after provenance and base hashes.                          |
| 5. Roads and paths                        | One shared linear editor: create a line, move/insert/remove vertices, rename and edit kind. One roads.geojson switch owns all road/path kinds.                                                                           | At least two distinct valid points, mode guard even on kind changes, explicit Apply/Cancel, reversible geometry, export/import/rebuild preview.                                |
| 6. Other layers                           | Additional building metadata, parks/land, water and then stops according to need.                                                                                                                                        | Per-file modes and geometry validators; ring/topology checks; labels stay inside footprints; stop edits account for duplicated transit-network coordinates and its provenance. |
| 7. Harden and deploy internally           | Durable drafts, recovery/conflict UX, larger datasets, authenticated hosting and reviewed release workflow.                                                                                                              | Fail storage/import/export visibly; cross-app regressions; host access verified. Collaboration/auth APIs require a separate actual requirement.                                |

Roads and paths share both roads.geojson and the same editing engine. `footway`, `pedestrian`, `path`, `track`,
`cycleway` and `steps` are kinds within that file; switching kinds cannot select another mode. Buildings and building
labels have separate switches and independent working features. Country outlines and Bus stops stay read-only: their
consistency needs an explicit data-owned workflow, without combining their file modes.

### Completed and remaining

- Completed: source inventory, module/boundary inspection, proposed architecture and sequence, local interactive sketch,
  building footprint editing, and readable geometry/rendering functions under the updated engineering guideline.
- Implemented slice 1: shared runtime consumed by the public app, independent core-only concept grid, and separately
  built real-data source viewer with eight file modes. Source overlays mask corresponding published geometry.
  Source-byte hashes and counts are verified before modes become available.
- Implemented slices 2-6: changeset contract and importer, one active-file command path, POI, address, footprint, road,
  park and water editing with relative moves and restore on interruption, per-file undo, export, import, shared
  validation fixtures, cross-file label checks and hole checks. Slice 7's durable drafts, snapshot conflict handling and
  visible storage failures are also done.
- Gaps against the slices:
  - Slice 4: the correction model is a reviewed ledger with before and after values (`editor-corrections.schema.json`).
    It separates local corrections from upstream facts, but features carry no local origin of their own, and it is not a
    stable identity. Adding an address to an unnumbered footprint is not supported.
  - Slice 5: no rebuild preview. The working overlay shows the edit, and the importer says when tiles need a rebuild.
  - Slice 6: no additional building metadata, which needs a building identity contract. Stops stay read-only by
    contract: they duplicate transit-network.json and need the transit import, so editing them waits for an actual need.
  - Slice 7: larger datasets have not been measured.
- Not implemented: refresh or rebase of corrections. Indices are bound to one snapshot, so a re-extract still replaces
  local edits, and an existing changeset stops at import. This needs the identity registry described above.
- Design choices to review: one active source file at a time; one Roads & paths switch with subtype tools; local
  export-first workflow; desktop inspector with a compact phone layout. No geometry dependency has been selected yet.

## Verification

### Shared core and real-data viewer

State of slice 1 on 2026-11-06, after the review, the cleanup and the split into independent projects:

- `make check` (each project's `verify`, 25 seconds) and `make check-docs`: passed.
- `make test-e2e`, no failures: apps/web 110 passed and 12 skipped (13.8 minutes), apps/editor 36 passed (1.6 minutes),
  apps/core-demo 4 passed (17 seconds).
- Source viewer and concept app inspected in a real browser at desktop 1440x1050 and phone 412x840, before the split:
  selection highlights render, published layers return after Browse, no horizontal overflow, smallest control 42px, no
  script errors.
- The extracted cartography and POI visibility output is deep-equal to the previous public implementation on the real
  places source, checked with a one-off comparison script against `HEAD`.
- Three independent compliance reviews. Their defects were fixed, except for the items under Handoff.

### Editing slices

`make check`, `make check-docs` and `make check-go` passed on the final code on 2026-11-06. `make -C apps/editor e2e`:
122 passed and 2 skipped (the touch tests run only in the phone project). Workflows through `act`: see Handoff. Two
deliberately broken behaviours, touch-cancel restore and the mode-switch guard, failed their tests, which were then
restored. An earlier `act` run of `ci-all` was invalid for packages/map-core, because a faulty script had emptied two of
its test files and `node --test` passes an empty file; they were rebuilt from `HEAD` plus their recorded edits, and a
review compared every assertion with `HEAD`.

## Handoff

Branch: `feat/internal-editor-draft`; dedicated worktree created through `make worktree`. All of this work, including
the editor, importer and contracts, is uncommitted. Based on main at `9b1f6e8`.

Run `make -C apps/core-demo dev` for shared capabilities and `make -C apps/editor dev` for real source inspection.
Current implementation details live with the component READMEs.

Known open items:

- The workflows ran through `act` from a clone on the final code, but not on GitHub, because nothing is pushed. Each of
  the 12 workflows passed when run alone. `make test-ci-all` completed its 14 single-project jobs, then `act` failed
  with `context deadline exceeded` while removing containers, so its browser jobs and the `CI gate` job have not run
  under `ci-all`. `cd-pages` is untested: it reads a real `ci-all` run from GitHub. See .github/TESTING.md for these
  local limits.
- Editor browser tests are sensitive to load: in that parallel run two desktop tests timed out at 15 seconds with the
  page still loading its sources, and passed on retry. Run on their own, the last two full runs had no failures. This
  belongs with the larger-dataset check.
- Formatting of new code is not enforced: .prettierrc.json covers Markdown only.
- Dense committed code outside this change remains in apps/web/src/app.js, apps/web/tools/finalize.mjs and older tests.

Open [the HTML draft](../../apps/editor/prototypes/editor.html) directly in a browser; no build/server/dependencies are
needed. [Draft notes](../../apps/editor/prototypes/README.md) describe controls and limits. Pending implementation work
above remains proposed; delete this plan when its implementing PR is complete and move enduring decisions to their
owning docs.
