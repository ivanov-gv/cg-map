# Internal layer editor

A separately built real-map source editor, using the published `@ivanov-gv/map-core` package, like the public app. It
changes nothing by itself: edits stay in the browser until exported as a changeset for the data-owned importer.

Run `make -C apps/editor dev` and open the printed local URL. The standalone artifact is `dist/editor`; it is never
included in `dist/web`. Pages serves it at [/editor/](https://ivanov-gv.github.io/cg-map/editor/), which is the simplest
place to install it from. It has no access control, and its data is already public.

The build assembles all eight reviewed source GeoJSON files through data-owned tooling. The editor verifies version,
filenames, byte sizes, SHA-256 and feature counts before enabling source modes. Hashes bind revision-local indices; they
are not invented upstream IDs. Selecting a feature reads full source geometry/properties, never simplified tiles.
Unknown properties, provenance and any source feature ID are displayed unchanged. Source files are never written.
Hashing needs a secure context, so anything but `localhost` must use HTTPS.

The map fills the window. Layers, Tools and Changes open panels over it; on narrow windows they are in the bottom bar.
The current-layer button also opens Layers. Source details, offline status and attribution are in Layers. Select an
object to open a right-side inspector on wide windows or a half-height bottom sheet on narrow ones. Its heading and
Apply / Cancel edge stay visible while the fields and collapsed source details scroll. Collapse (including the sheet
handle) preserves the selection, typed values and geometry preview; a compact button names the selected object and
reopens it with Enter or Space. Opening or replacing a utility panel also preserves the edit. The phone inspector
follows the visual viewport so the active field and actions remain above the onscreen keyboard.

Layers has exactly one switch per source file. Footprints and labels are independent; roads and paths share
roads.geojson. Only one source file is selectable at once. The active file keeps normal map styles, names and category
icons using its working features. Browse restores the reviewed release. Hollow green guides identify unchanged objects;
amber guides identify applied changes. A blue outer outline marks selection independently. Tools can hide guides without
closing the inspector or discarding an edit. Guides appear from zoom 15 and can reveal POIs below their public
threshold; with guides off, only normally rendered objects can be selected, using public thresholds and label collision
rules. Country outlines and bus stops remain read-only, with their own outlines or stop symbols and names.

When a click or tap hits several objects, a named chooser lets you select each one. Objects in the toolbar lists visible
objects in the current map view, including co-located POIs; use Tab and Enter or Space to select one. Names include
geometry and a revision-bound feature key to distinguish duplicates. Large lists have Previous / Next pages. Moving the
map refreshes the list, and Browse clears it. Selecting from either list preserves any unapplied edit until Apply or
Cancel. Switching modes shows a loading status until the new source has rendered, and clicks wait for it. Opening
Objects during loading keeps keyboard focus on its status until the first object is ready. Satellite is a separate
viewing control.

Paging bounds the list's DOM work, but collecting rendered hits and comparing their labels still covers the whole view.
A wide view of buildings or roads can involve tens of thousands of hits; zoom in to reduce that work.

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

Cancel discards the open edit. Escape interrupts an active drag, restoring its start while keeping earlier adjustments;
otherwise it collapses the foremost panel and returns focus to its opener. Apply is a keyboard-accessible button; Enter
in a property field also applies the form. Apply, Cancel and Delete return keyboard focus to the status message. A mode
switch drops a geometry preview, but typed details block it until they are applied or cancelled. Any unapplied edit
blocks undo, redo, adding a feature, export, import and discarding.

A footprint and its label never rewrite each other. If an edit leaves a label outside its footprint, the review panel
names it and export stays disabled until it is corrected in its own mode.

Pending changes are saved in this browser's localStorage after every change, and a failed save is shown as an error. A
draft that cannot be resumed, because it was made on another version of a source or cannot be read, moves to its own
storage slot, where autosave cannot overwrite it, until you download or discard it. If it cannot even be moved there, it
stays in place and autosave stays off, with a visible error, until you do. Discarding asks first, then saves at once.
Outside a mode the map shows the reviewed release, so a pending edit appears only in its own mode. Review and export
stay available there.

Preview all edits shows the map as a rebuild would publish it: every changed file's working features, drawn by the
public map's own layers in place of the released ones. It starts from Browse and ends when you choose a mode or Browse.
It is not an actual rebuild. Below street scale the tiles simplify geometry and drop minor roads, which the preview does
not do, so it shows more detail there than the release will. Shared POI markers and their zoom bands are rebuilt from
the working places, including new combinations of levels at one location.

### Larger datasets

`make -C apps/editor measure-datasets` repeats the features of buildings.geojson and roads.geojson and times the real
editor. Measured on 2026-11-07, one run per size, on a 16-thread machine with software rendering:

| Size of both files         | Startup | Open Buildings | Open Roads & paths | JavaScript heap |
| -------------------------- | ------- | -------------- | ------------------ | --------------- |
| Today: 25,213 + 17,881     | 2.4 s   | 1.5 s          | 0.9 s              | 104 MB          |
| 2 times                    | 2.0 s   | 2.0 s          | 1.5 s              | 78 MB           |
| 4 times                    | 2.6 s   | 3.3 s          | 2.6 s              | 228 MB          |
| 8 times: 201,704 + 143,048 | 3.8 s   | 6.2 s          | 4.2 s              | 595 MB          |

Opening a mode grows about linearly, and at 8 times takes long enough to notice but still works. The heap figures are
one reading at an arbitrary moment of garbage collection, so only their overall growth means anything. This does not
measure a phone, or edits and export at these sizes.

### Limits

- Not editable: building metadata other than addresses, adding an address to an unnumbered footprint, and adding or
  deleting footprints or labels. These need a building identity contract that does not exist yet.
- Parks and water can be reshaped and renamed, but not added or deleted: the contract allows only modifications there.
- The preview is not a rebuild: see Preview all edits above. The importer says when tiles need one.
- Corrections cannot follow a re-extract. References are bound to one snapshot, so an old changeset is refused.
- Editing water rewrites that whole file through JSON serialization, which normalizes a coordinate written as `41.0` in
  the ocean feature. Expect that one extra line of difference on the first water edit.

## Install on your devices

The editor is an offline-first app with no accounts. The server is needed only to install or update it: every file,
including the map and all sources, is then stored on the device. Pages has trusted HTTPS, so opening
[/editor/](https://ivanov-gv.github.io/cg-map/editor/) and using Install in Chrome needs no setup.

To run it from your own machine instead:

```sh
make -C apps/editor lan
```

This builds the editor and serves it on port 8443 to your LAN over HTTPS. Keep that port: the browser ties an installed
app to its address, so another address or port is a separate install with separate drafts. A fixed LAN address, reserved
on your router, avoids that. Set another port with `LAN_PORT=`.

Chrome allows service workers and install only on a secure origin, and refuses them over an untrusted certificate even
if you click through the warning. So each device trusts a private certificate authority once:

1. The first run creates it in `~/.config/lan-ca` (`LAN_CA_DIR` overrides that) and prints its fingerprint. It stays
   outside the repository so that other services on your LAN can use it too. Never share or commit `ca.key`.
2. On the laptop, import `ca.crt` as a trusted authority in Chrome, under Settings, Privacy and security, Security,
   Manage certificates. Or use `make -C apps/editor dev` on the machine itself: `localhost` needs no certificate, but it
   is a different address, so it has its own install and drafts.
3. On an Android phone, open `/lan-ca.crt` on the printed URL and accept the warning that one time. Install the
   downloaded file under Settings as a CA certificate, then compare the fingerprint under trusted credentials, and
   remove it if it differs: until then, that download is unverified.
4. Open the printed URL and use Install in Chrome.

These device steps have not been tried on a real phone yet.

The authority's name constraints cover only private addresses (including `fc00::/7` and `100.64.0.0/10`) and
`localhost`, `.local`, `.lan`, `.home`, `.home.arpa`, `.internal` and `.localdomain`. OpenSSL enforces them, as the
tests show, even against a certificate signed with the authority's own key. Other clients may not check them on an
authority you installed yourself, so treat `ca.key` as able to impersonate any site on a device that trusts it, and keep
it private and backed up. It is not encrypted, so that servers can start unattended. The list cannot change later
without trusting a new authority on every device.

Anyone on your LAN can read what this server serves while it runs: the reviewed sources and map, nothing else. It
accepts no writes.

### Offline and updates

The status in Layers says when the copy is saved. A notice on the map calls attention to storage warnings and updates.
Every file is checked against the release manifest before it is stored. A failed or tampered download is reported and
the current version keeps working. The map archive is stored apart, named by its content, so an update with the same map
does not download it again. An update that changes the map needs room for both archives for a moment.

With the server reachable, opening the editor finds a new build and offers Update and reload. It waits while an edit is
open or while applied edits could not be saved. Updating reloads every other editor window too, except one with unsaved
work, which says so and keeps running. A browser also activates a waiting version by itself once every window of the app
is closed, so reopening it can bring the new version without a click. Updating first waits for every window's map to
finish loading, up to 5 seconds: a map read that reaches the current version as the browser stops it would otherwise
hold the update for up to 5 minutes. If that still happens, for example because someone moves a map at that moment, the
editor says to close its windows. No applied edit is lost either way.

A draft resumes only on the same source files. If a new build changes any file you have pending changes in, the whole
draft is set aside for download, as raw draft data rather than a changeset, so export a changeset before updating.
Applying your own changeset and rebuilding always does this. Use one editor window at a time: windows share one saved
draft, and the last one to save wins.

`make -C apps/editor dev` installs the worker as well, so after a rebuild its origin keeps the previous build until you
click Update and reload.

Each device keeps its own drafts. To move work between devices or apply it, export a changeset on that device, then
import it on another or apply it on the machine with the repository.

## From export to reviewed sources

Export downloads a changeset with base hashes, fingerprints and full before/after features; each changed file can also
be downloaded as plain GeoJSON for GIS inspection. Import resumes a changeset on the same snapshot, and is refused whole
on any mismatch. Apply it with `make -C data apply-changeset CHANGESET=<absolute path>`; see the
[data runbook](../../docs/runbooks/data.md#editor-changesets).

Run `make verify PKG=apps/editor` and `make -C apps/editor e2e`; tests/e2e covers both URL prefixes. Use `make check`
after runtime changes. Sources and their provenance stay with data; the bundle contract lives in packages/contracts.
This app has no editorial API.

The default preview uses a separate deterministic port/origin from the public app, preserving that app's service worker
and offline caches. The editor's own worker keeps its caches under an `editor-` prefix and never touches another app's.
