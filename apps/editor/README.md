# Internal layer editor

A separately built real-map source editor, sharing packages/map-core with the public app. It changes nothing by itself:
edits stay in the browser until exported as a changeset for the data-owned importer. The fictional interaction
[draft](prototypes/editor.html) remains as the reference for the original tool design.

Run `make -C apps/editor dev` and open the printed local URL. The standalone artifact is `dist/editor`; it is never
included in `dist/web` or deployed by the Pages pipeline. Hosting and authentication are not built. Do not deploy the
internal artifact without choosing host access controls.

The build assembles all eight reviewed source GeoJSON files through data-owned tooling. The editor verifies version,
filenames, byte sizes, SHA-256 and feature counts before enabling source modes. Hashes bind revision-local indices; they
are not invented upstream IDs. Selecting a feature reads full source geometry/properties, never simplified tiles.
Unknown properties, provenance and any source feature ID are displayed unchanged. Source files are never written.
Hashing needs a secure context, so a deployed editor must use HTTPS.

The dock has a layers table and exactly one switch per source file. Footprints and labels are independent; roads and
paths share roads.geojson. Only one source overlay is selectable at once. Browse removes it, and the corresponding
published layers are restored. Source overlays ignore public POI visibility thresholds. Switching modes shows a loading
status until the new source has rendered, and clicks wait for it. Satellite is a separate viewing control.

## Editing

`packages/contracts/editor-layers.json` says what each file allows:

| Mode                        | Edits                                                                |
| --------------------------- | -------------------------------------------------------------------- |
| POIs                        | Details, level, move, add, delete                                    |
| Roads & paths               | Name, kind, points, whole-line move, draw, delete                    |
| Buildings                   | Corners and whole-footprint move                                     |
| Building labels             | Existing addresses and position                                      |
| Land, Water                 | Parks, water and rivers only: name and shape                         |
| Country outlines, Bus stops | Read-only, with the reason shown; they have their own data workflows |

Selecting a feature opens its form and tools. Nothing is recorded until Apply, which validates the result with the same
rules as the importer. Every edit passes through one command path that can reach only the active file; importing a
reviewed changeset is the one exception, because a changeset names its own files.

Moving is a relative drag or one-finger swipe that starts anywhere on the map, so a feature never jumps to the contact
point, and several drags adjust one preview. A corner or line point is tapped to select it, then moved the same way. A
second finger or losing the window restores the position from before that gesture. A tap places a new point or adds a
line point. Dragging a whole shape or a vertex pans nothing; with nothing to move, the map pans as usual.

Cancel and Escape drop the open edit. A mode switch drops a geometry preview, but typed details block it until they are
applied or cancelled. Any unapplied edit blocks undo, redo, adding a feature, export, import and discarding.

A footprint and its label never rewrite each other. If an edit leaves a label outside its footprint, the review panel
names it and export stays disabled until it is corrected in its own mode.

Pending changes are saved in this browser's localStorage after every change, and a failed save is shown as an error. A
draft that cannot be resumed, because it was made on another version of a source or cannot be read, moves to its own
storage slot, where autosave cannot overwrite it, until you download or discard it. If it cannot even be moved there, it
stays in place and autosave stays off, with a visible error, until you do. Discarding asks first, then saves at once.
Outside a mode the map shows the reviewed release, so a pending edit appears only in its own mode. Review and export
stay available there.

### Limits

- Not editable: building metadata other than addresses, adding an address to an unnumbered footprint, and adding or
  deleting footprints or labels. These need a building identity contract that does not exist yet.
- Parks and water can be reshaped and renamed, but not added or deleted: the contract allows only modifications there.
- No preview of rebuilt tiles: the working overlay shows a geometry edit, and the importer says when a rebuild is
  needed.
- Corrections cannot follow a re-extract. References are bound to one snapshot, so an old changeset is refused.
- Editing water rewrites that whole file through JSON serialization, which normalizes a coordinate written as `41.0` in
  the ocean feature. Expect that one extra line of difference on the first water edit.

## From export to reviewed sources

Export downloads a changeset with base hashes, fingerprints and full before/after features; each changed file can also
be downloaded as plain GeoJSON for GIS inspection. Import resumes a changeset on the same snapshot, and is refused whole
on any mismatch. Apply it with `make -C data apply-changeset CHANGESET=<absolute path>`; see the
[data runbook](../../docs/runbooks/data.md#editor-changesets).

Run `make verify PKG=apps/editor` and `make -C apps/editor e2e`; tests/e2e covers both URL prefixes. Use `make check`
after runtime changes. Sources and their provenance stay with data; the bundle contract lives in packages/contracts.
This app has no editorial API or service worker.

The default preview uses a separate deterministic port/origin from the public app, preserving its existing service
worker and offline caches. A deployed editor also needs its own origin or a path outside the public worker scope.
