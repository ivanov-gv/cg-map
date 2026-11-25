# Internal layer editor

A separately built real-map source editor, using the published `@ivanov-gv/map-core` package, like the public app. It
changes nothing by itself: edits stay in the browser until exported as a changeset for the data-owned importer.

Run `make -C apps/editor dev` and open the printed local URL. The standalone artifact is `dist/editor`; it is never
included in `dist/web`. Pages serves it at [/editor/](https://ivanov-gv.github.io/cg-map/editor/), which is the simplest
place to install it from. It has no access control, and its data is already public.

The build assembles every reviewed source file of bundle version 3 through data-owned tooling. The editor also accepts
versions 1 and 2 from older reviewed bundles. It verifies the manifest version, filenames, byte sizes, SHA-256 and
feature counts before enabling source modes. Hashes bind revision-local indices; they are not invented upstream IDs.
Selecting a feature reads full source geometry/properties, never simplified tiles. Unknown properties, provenance and
any source feature ID are displayed unchanged. Source files are never written. Hashing needs a secure context, so
anything but `localhost` must use HTTPS.

The map fills the window. Layers, Tools and Changes open panels over it; on narrow windows they are in the bottom bar.
The current-layer button also opens Layers. Select an object to open the inspector, on the right or as a bottom sheet.
Its heading and Cancel / Apply stay visible while the fields scroll. Collapse keeps the selection, typed values and
geometry preview; a compact button reopens it. Opening another panel keeps the edit too. The phone inspector follows the
visual viewport so the active field and actions stay above the onscreen keyboard.

## Layers

The ten layers are the wiki's ([UI 4.Editor](https://github.com/ivanov-gv/cg-map/wiki/UI---4.Editor)); their files are
in [editor-layers.js](src/editor-layers.js). Exactly one is active. Its objects have a green outline, applied changes of
every layer are amber, the picked object is red, an object marked in the field is dashed red with a cross. The others
stay as context. Guides appear from zoom 15, or earlier on layers edited zoomed out, and can reveal POIs below their
public threshold; with guides off in Tools, only normally rendered objects can be picked. Country, neighbour and sea
shapes are drawn and never picked, because they follow from other objects.

When a tap hits several objects, a named chooser lets you pick one. Objects in view, in Tools, lists what is on screen,
including co-located places and records without a place on the map; use Tab and Enter or Space. Selecting from a list
keeps an unapplied edit until Apply or Cancel. Collecting rendered hits covers the whole view, so zoom in on dense
layers.

An address has one number, the one written in the address, and a street.

What the layers do beyond shape and fields:

- **Buildings** show their entrances and the places inside. Moving one takes its address, entrances and places with it;
  after a corner edit entrances return to the outline. A new entrance goes to the nearest point of the outline and gets
  the next number. Deleting asks whether the places inside move to another building, picked on the map, or go too.
- **Addresses** take a street from the Roads layer, nearest first. Fill the gaps shows only buildings without a number
  and goes from one to the nearest next.
- **Places & points** belong to the building they are put on, or stand on their own. Opening hours have an editor for
  the OpenStreetMap format; text it cannot show is kept.
- **Roads & paths** are a graph: two roads join where they share a point on the same level
  ([road-graph.js](src/road-graph.js)). From zoom 16 a full dot is a join, a hollow one a dead end, and `!` marks roads
  that touch, cross or nearly meet without joining. A dot opens its junction: the level of each road there, what stands
  on it, the allowed turns, and joining, disconnecting or splitting roads. Letters A and B name the ends of the picked
  road. A dragged point joins the road it is put on and takes joined roads along until it is disconnected. The level
  picker shows one level at a time; below the ground rails are dashed, above it strong.
- **Parks & green** and **Water** have holes and islands. Waterways show their joins with the same dots and keep them
  when either side moves; moving the coastline moves the sea, the country, its border and the municipalities.
- **Relief:** a dragged contour stops at the next line, a summit must be higher than the contours around it, a ridge
  recolours the slopes beside it and its ends slide along the outline of its hill.
- **Settlements & borders:** a settlement says its type and opens its area, or draws one. A border changes both sides at
  once. Its ends stay, because more than two municipalities meet there. The coast is moved on Water.
- **Stops** go to the side of the road that is clicked and follow the road when moved.
- **Routes** are stops in order; the way along the streets is drawn for the editor and not stored. Turn points force it.
  On a phone they can be read only.

Sketches, notes and deletion marks from the field travel in the exported file. At the desk they wait in Changes under
From the field; choosing one opens its layer, over satellite for a sketch, and Apply becomes Apply and resolve.

## Editing

`packages/contracts/editor-layers.json` says what each file allows; what a layer adds to that is its behavior in
[layer-behaviors.js](src/layer-behaviors.js) and the modules that register one. Nothing is recorded until Apply, which
validates the result with the same rules as the importer. One Apply is one step, which can change several files of the
layer and is undone as a whole. After Apply the map shows the result at once, Changes counts it, and a toast offers
Undo. Importing a reviewed changeset is the one exception to "only the active layer", because it names its own files.

A property whose rule lists its values is picked from a list, and so is a small range of whole numbers. A free one that
usually says the same things, such as floors, road numbers or the streets around, offers those with Other…
([usual-values.js](src/usual-values.js)). Names, contacts, house numbers and heights are typed. A test keeps every
property in one of these groups.

Move, Edit corners and drawing are modes: the inspector shrinks to one bar with Done, and the original shape stays as a
thin dashed ghost until Apply. Whatever goes along with it, such as the roads of a moved junction, is shown in red where
it would be, and the bar says why Apply would refuse it. Moving is a relative drag or swipe that starts anywhere, so
nothing jumps to the contact point. In corner mode a small handle in the middle of a side adds a point. While drawing,
the bar shows the length of the side and the area; Shift keeps right angles, a click on the first corner closes a shape,
a double click ends a line. On a phone drawing uses a fixed cross: move the map under it, then Add. A second finger or
losing the window restores the position from before that gesture.

The magnet takes a dragged or drawn corner of an area, including a hole corner, to a corner of another object of its
file close by, otherwise onto its side, and a moved area with its closest corner. It keeps every new corner off corners
the shape already has, so a later point cannot fold it together. A double click is two taps close together on screen,
whatever each one snapped to, and the point the second tap added is dropped. On a phone a second Add without moving the
cross says so in the bar and adds nothing. A hole corner also stays off the outline the hole cuts. The points of roads
and waterways join others the same way. The `Magnet` button in the modes where it applies shows its state with
`aria-pressed` and is remembered in this browser. What an edit newly overlaps is outlined in blue and counted and named
in the bar and in the inspector; it is not refused, because some sources do overlap
([area-magnet.js](src/area-magnet.js), [area-overlap.js](src/area-overlap.js)).

Deleting asks first at the desk. On a phone it only marks the object: the mark travels in the exported file and the desk
confirms it. Marks wait in Changes under From the field and are never written to a source.

Cancel discards the open edit. Escape interrupts a drag, then ends a move or corner mode, then closes the foremost
surface and returns focus to its opener. Apply, Cancel and Delete return keyboard focus to the status message. Switching
layers with an unapplied edit asks whether to apply it, discard it or keep editing. Keyboard shortcuts: `Ctrl+Z` undoes,
`Ctrl+Shift+Z` or `Ctrl+Y` redoes (`⌘` on macOS), outside text fields. Any unapplied edit blocks undo, redo, adding,
export, import and discarding.

If an edit leaves an address outside its footprint, the review panel names it and export stays disabled until it is
corrected.

Pending changes are saved in this browser's localStorage after every change, and a failed save is shown as an error. A
draft that cannot be resumed, because it was made on another version of a source or cannot be read, moves to its own
storage slot, where autosave cannot overwrite it, until you download or discard it. If it cannot even be moved there, it
stays in place and autosave stays off, with a visible error, until you do. Discarding asks first, then saves at once.
The Changes panel compares changed fields beside the change list on wide screens, and opens one change at a time on
narrow screens. Export opens a dialog for the author and reason; import and discard are under Secondary actions.

Changed files are drawn with the public map's own layers from their working features. This is not a rebuild: below
street scale the tiles simplify geometry and drop minor roads, which the editor does not do.

### Larger datasets

`make -C apps/editor measure-datasets` repeats the features of buildings.geojson and roads.geojson and times the real
editor. Measured on 2026-11-07 on a 16-thread machine with software rendering, using the previous 25,213 + 17,881
features:

| Size of both files         | Startup | Open Buildings | Open Roads & paths | JavaScript heap |
| -------------------------- | ------- | -------------- | ------------------ | --------------- |
| Previous: 25,213 + 17,881  | 2.4 s   | 1.5 s          | 0.9 s              | 104 MB          |
| 2 times                    | 2.0 s   | 2.0 s          | 1.5 s              | 78 MB           |
| 4 times                    | 2.6 s   | 3.3 s          | 2.6 s              | 228 MB          |
| 8 times: 201,704 + 143,048 | 3.8 s   | 6.2 s          | 4.2 s              | 595 MB          |

Current sources have 43,978 buildings and 21,247 roads; these figures were not remeasured after that whole-city refresh.
Opening a mode grows about linearly, and at 8 times takes long enough to notice but still works. The heap figures are
one reading at an arbitrary moment of garbage collection, so only their overall growth means anything. This does not
measure a phone, or edits and export at these sizes.

### Limits

- Changed files are not a rebuild: see above. The importer says when tiles need one.
- Routes have no identity of their own in the data, so a changeset that edits one needs the exact snapshot.
- Zoom levels of towns and summits, energy classes and stop turn points are recorded but not yet drawn by map-core.
- A border or coastline edit needs `make -C data check-topology` after it is applied. A coastline that the sea, the
  country, its border or a municipality cannot follow is refused; a few detailed stretches are.
- A rule that allows only one turn is shown on its junction and not edited there.
- A phone's own height may count from the ellipsoid, about 40 m above sea level here.
- Buildings without a number are dashed amber while Fill the gaps is on, not on the Buildings layer.

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

Local `make verify PKG=apps/editor` and `make -C apps/editor e2e` after runtime changes are optional for iterating; the
pre-push `make check` is required (builds and non-browser checks, no browser suites). GitHub's PR run gates the merge.
tests/e2e covers both URL prefixes. Sources and their provenance stay with data; the bundle contract lives in
packages/contracts. This app has no editorial API.

The default preview uses a separate deterministic port/origin from the public app, preserving that app's service worker
and offline caches. The editor's own worker keeps its caches under an `editor-` prefix and never touches another app's.
