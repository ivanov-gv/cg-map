# Internal layer editor

A separately built real-map source editor on `@ivanov-gv/map-core`, like the public app. Non-release builds bundle the
core of this commit; a release bundles the exact pinned version. It changes nothing by itself: edits stay in the browser
until exported as a changeset for the data-owned importer.

## Build inputs

`build`, `dev`, `lan`, the CI artifact and the dev Pages site take core, data and contracts from the checked-out commit.
`make -C apps/editor build-release` takes the exact versions pinned in `package.json` and refuses any other core.
Automated tests and the browser suite keep their pins, so a change in core cannot change a test without a pin bump
([ADR 0046](../../docs/decisions/0046-editor-builds-take-their-own-core.md)).

Run `make -C apps/editor dev` and open the printed local URL. The standalone artifact is `dist/editor`; it is never
included in `dist/web`. Pages serves it at [/editor/](https://ivanov-gv.github.io/cg-map/editor/), which is the simplest
place to install it from. It has no access control, and its data is already public.

The build assembles every reviewed source file of bundle version 3 through data-owned tooling. The editor also accepts
versions 1 and 2 from older reviewed bundles, and version 4: version 3 plus `bridges.geojson` and `railways.geojson`,
without the derived `slopes.geojson`. Version 5 declares twelve files: `surface.geojson`, `roads.geojson`,
`bridges.geojson`, `railways.geojson`, `buildings.geojson`, `places.geojson`, `settlements.geojson`, `relief.geojson`,
`canyon-rims.geojson`, `transport-stops.geojson`, `transit-network.json` and `transit-routes.json`. It keeps land cover,
water, waterways, shades, protected areas and the border frame in `surface.geojson`, merges contours and summits into
`relief.geojson`, and holds the representative network in `transit-network.json`. The producer still emits version 3, so
versions 4 and 5 are read only when one is published. It verifies the manifest version, filenames, byte sizes, SHA-256
and feature counts before enabling source modes. Hashes bind revision-local indices; they are not invented upstream IDs.
Selecting a feature reads full source geometry/properties, never simplified tiles. Unknown properties, provenance and
any source feature ID are displayed unchanged. Source files are never written. Hashing needs a secure context, so
anything but `localhost` must use HTTPS.

The map fills the window. Layers, Tools and Changes open panels over it; on narrow windows they are in the bottom bar.
The current-layer button also opens Layers. Select an object to open the inspector, on the right or as a bottom sheet.
Its heading and Cancel / Apply stay visible while the fields scroll. Collapse keeps the selection, typed values and
geometry preview; a compact button reopens it. Opening another panel keeps the edit too. The phone inspector follows the
visual viewport so the active field and actions stay above the onscreen keyboard.

## Source layout

`src/` is sorted by feature: `app.js` wires the editor at `src/` root, `app/` holds workspace panels, `editing/` keeps
draft, changeset and review state, `inspector/` owns the property panel, `geometry/` holds shape math, `layers/<name>/`
holds each layer with `layers/shared/` for the registry and shared layer UI, `source-data/` loads the verified bundle,
`map-tools/` holds map interaction tools, `offline/` keeps the local copy while `sw.js` stays at `src/` root for
service-worker scope, and `shared/` holds small DOM and hash helpers. Unit tests go next to their source as `*.test.js`;
browser cases that need only a component go next to it as `*.browser.test.js` and use the harness in `tests/e2e/support`
without starting `app.js`. Whole-app journeys live in `e2e/`; tests that span sources stay in `tests/`; tool tests stay
in `tools/`; `npm test` skips `*.browser.test.js`. ESLint uses this app's `eslint.config.mjs` with the shared rules;
`npm run lint` covers the source folders, tools, tests, `e2e/`, both app configs and that config itself.

## Layers

The eleven layers are the wiki's ([UI 4.Editor](https://github.com/ivanov-gv/cg-map/wiki/UI---4.Editor)) with Railways
added to its Transport group; their files are in [editor-layers.js](src/layers/shared/editor-layers.js). A bundle
without `bridges.geojson` or `railways.geojson` leaves those layers out. Version 5 keeps the layer choices but splits
its one surface file by kind: green takes land cover, shades and protected areas, water takes water areas and waterways,
and settlements takes municipalities, neighbour countries and the sea; the addresses layer and the derived label and
slope files are gone. Exactly one layer is active. Its objects have a green outline, applied changes of every layer are
amber, the picked object is red, and an object marked in the field is dashed red with a cross. The others stay as
context. Guides appear from zoom 15, or earlier on layers edited zoomed out, and can reveal POIs below their public
threshold; with guides off in Tools, only normally rendered objects can be picked. In released bundles the country,
neighbour and sea shapes are drawn and never picked, because they follow from other objects. Version 5 stores the
neighbour and sea polygons in `surface.geojson`; the settlements layer edits them, while the country outline has no
stored object.

When a tap hits several objects, a named chooser lets you pick one. Objects in view, in Tools, lists what is on screen,
including co-located places and records without a place on the map; use Tab and Enter or Space. Selecting from a list
keeps an unapplied edit until Apply or Cancel. Collecting rendered hits covers the whole view, so zoom in on dense
layers.

What the layers do beyond shape and fields:

- **Buildings** show their entrances and the places inside. Moving one takes its address, entrances and places with it;
  after a corner edit entrances return to the outline. A new entrance goes to the nearest point of the outline and gets
  the next number. Deleting asks whether the places inside move to another building, picked on the map, or go too.
- **Addresses** take a street from the Roads layer, nearest first. Fill the gaps shows only buildings without a number
  and goes from one to the nearest next.
- **Places & points** belong to the building they are put on, or stand on their own. Opening hours have an editor for
  the OpenStreetMap format; text it cannot show is kept.
- **Roads & paths** are a graph: two roads join where they share a point on the same level
  ([road-graph.js](src/layers/roads/road-graph.js)). From zoom 16 a full dot is a join, a hollow one a dead end, and `!`
  marks roads that touch, cross or nearly meet without joining. A dot opens its junction: the level of each road there,
  what stands on it, the allowed turns, and joining, disconnecting or splitting roads. Letters A and B name the ends of
  the picked road. A dragged point joins the road it is put on and takes joined roads along until it is disconnected.
  The level picker shows one level at a time; below the ground rails are dashed, above it strong. Bridge outlines are
  edited here too: one deck sits under all the roads marked as bridges, and those roads keep their own bridge tags.
- **Parks & green** and **Water** have holes and islands. Waterways show their joins with the same dots and keep them
  when either side moves; moving the coastline moves the sea, the country, its border and the municipalities. Version 5
  reads both from `surface.geojson`. The owner draws a shade for a chosen green area; only the link to that area is
  stored, never a scaled copy. The drawn ring is stored as a `MultiPolygon`, and its whole filled area, not just its
  corners, must stay inside the area including around holes: a shade may not cover a courtyard the hole cuts out.
  Shrinking, deleting or retyping the area with its shade still linked is refused. Apply or Cancel the parent before
  drawing its shade, so drawing never discards an open edit. A water area picks its `riverEntityId` from the waterway
  lines of the same file; a river polygon is not offered, the optional link can be cleared, a link to an area or a
  missing waterway is refused, and the card of a linked lake opens its waterway. Kind and geometry are one decision: a
  frame kind cannot be invented by retyping, and fields allowed only for the old kind are rechecked after a retype.
- **Stored positions:** `labelPoint`, `labelLine` and `iconPoint` are drawn where the source stores them in version 5.
  Each has its own Move tool; a label line keeps its distinct points and order as it shifts. Coordinates must be WGS84,
  a lake icon must stay in its lake, and a new lake POI can place its still-unset icon as soon as the form says so. They
  are never derived from the outline and are not pickable objects.
- **Relief:** a dragged contour stops at the next line, a summit must be higher than the contours around it. In bundles
  with `slopes.geojson`, a ridge recolours the slopes beside it and its ends slide along the outline of its hill; an end
  cannot be removed, only moved there. Version 4 has no slopes file, so moving a ridge neither recolours anything nor
  slides its ends. In released bundles ridges are derived edges between slopes, so they cannot be added or deleted here.
  Version 5 stores contours and summits in `relief.geojson` and shades in the surface instead of ridges and slopes; the
  ridge tools do not apply there.
- **Settlements & borders:** a settlement says its type and opens its area, or draws one. A border changes both sides at
  once. Its ends stay, because more than two municipalities meet there. The coast is moved on Water. In version 5 the
  stored municipality polygons, neighbour countries and sea come from `surface.geojson`; one step moves every outline
  holding a changed frame edge, including neighbour, sea and hole boundaries. An edit that would leave a gap or overlap
  is refused, and the whole step is undone from each layer that draws the file.
- **Stops** go to the side of the road that is clicked and follow the road when moved. Version 5 identifies a new stop
  by its `stopId` alone; the released feature-level `id` is not written or required there.
- **Routes** are stops in order; the way along the streets is drawn for the editor and not stored. Turn points force it.
  On a phone they can be read only. Version 5 keeps `transit-routes.json` under the released rules and still gives a new
  intercity direction its local ID, without deriving a headsign from the last stop. `transit-network.json` is read as
  one document and has no edit operations.
- **Railways** are tracks, platforms, halts and stations. The kind says whether a new one is a point, a line or an area;
  tracks and platforms are drawn by the public map style from this file. They are in version 4 bundles.

Sketches, notes and deletion marks from the field travel in the exported file. At the desk they wait in Changes under
From the field; choosing one opens its layer, over satellite for a sketch, and Apply becomes Apply and resolve.

## Editing

`packages/contracts/editor-layers.json`, pinned at 0.3.0 for tests and releases, says what each file allows, including
`addOnly` provenance fields for bridge and railway outlines. The top-level rules serve bundle versions 1–4; a verified
version 5 selects `bundleRules["5"]` instead, with its rule format still at 2. The editor checks its per-kind keys
(`requiredForKinds`, `allowedForKinds`, `requiredWithAny` and `requiredWithAnyForKinds`), exclusive numeric limits,
distinct `position`/`positions` values, and rechecks kind-scoped fields after a retype. It never applies a released-only
field to version 5. A frame kind of `surface.geojson` allows its stored geometry and only the properties its
`limitedKinds` list. What a layer adds to the rules is its behavior in
[layer-behaviors.js](src/layers/shared/layer-behaviors.js) and the modules that register one. Nothing is recorded until
Apply, which validates the resulting file with the same rules as the importer; Delete, an imported changeset, Undo and
Redo use the same check before writing anything. One Apply is one step, which can change several files of the layer and
is undone as a whole. After Apply the map shows the result at once, Changes counts it, and a toast offers Undo.
Importing a reviewed changeset is the one exception to "only the active layer", because it names its own files: it is
registered in every affected layer's history and taken back as one step, so taking it back cannot leave a shade without
its area. Version 5 routes keep the released card and display, but derive neither a headsign from a stop name nor the
retired `stops.lines` field.

A property whose rule lists its values is picked from a list, and so is a small range of whole numbers. A free one that
usually says the same things, such as floors, road numbers or the streets around, offers those with Other…
([usual-values.js](src/inspector/usual-values.js)). Names, contacts, house numbers, entrance numbers and heights are
typed. A test keeps every property in one of these groups.

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
([area-magnet.js](src/geometry/area-magnet.js), [area-overlap.js](src/geometry/area-overlap.js)).

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

Changed files are drawn at once with the published layers found in the running map's own style, from their working
features: a canyon edge gets all of map-core's wall bands and its rim, a bridge outline gets its deck and edges,
railways get their tracks and platforms, and protected areas get park names of their own alongside land's. The editor
copies the style's paint, layout, filters and zoom ranges; it keeps no parallel cartography. Several published layers
that draw one ordinary file share its preview source, and the original is hidden and restored once; only files whose
features differ by published layer need one source per layer. For version 5 the complete working `surface.geojson`
reaches every published surface layer of the running style, with one source per layer: the active layer only decides
which kinds can be picked. Municipalities take the public water fill, water areas likewise, and waterway lines take the
river layer, so a river polygon never gets a river stroke. Stored label points and lines are handed to the label layers
in place of the object's outline, so a moved label is drawn where the source says. Every preview feature carries the
working file and a stable selection key, so a hit on public cartography with guides off opens the same object. Opening
another surface layer cannot hide an earlier edit, and applying while a surface layer stays active refreshes its preview
sources. A file the public style does not draw, such as an entrance or a bus stop, keeps its editor inspection layer;
the Editor itself adds only selection, guides, handles and in-progress overlays. This is not a rebuild: below street
scale the tiles simplify geometry and drop minor roads, which the editor does not do.

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
- A version 4 bundle has no slopes file. Moving a ridge changes the ridge alone; recolouring the derived slopes is not
  possible there, and adding or deleting a ridge stays a later step.
- Version 5 is read from the pending contract, not yet emitted by data. The pinned map-core 0.4.0 has no version 5
  tiles: the whole surface is previewed through the released land, water and label layers, and stored label geometry is
  handed to those layers when they exist. Core publishes no `shades` source layer or settlement-label layer consuming
  `labelPoint`, so the Editor cannot paint those stored facts with the pinned style; it keeps them in the inspector and
  changeset until the core and Web steps land. It does not add its own map-content layers for them.
- Any nonempty version 5 `places.geojson` reaches pinned map-core 0.4.0's retired `properties.id` marker sort, whether a
  place uses `kind`, `poiKind` or the old `id`. The Editor stops before installing places and reports:

  ```text
  Version 5 POIs in places.geojson need map-core support for iconPoint. Pinned map-core 0.4.0 sorts markers by the retired properties.id and throws TypeError: undefined is not iterable; the Editor stops before opening.
  ```

  There is no editor-side workaround; the fixture bundle leaves that file empty.

- Version 5 has no live slope preview from ridges. Shades replace ridges and slopes in the model; the shared-derivation
  step of #490 is not part of this reader. `transit-network.json` is read-only, and transit rules wait on #527.
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
pre-push hook runs the checks selected by the pushed diff (no browser suites, `make check` on failure). GitHub's PR run
gates the merge. The browser suite covers both URL prefixes. Sources and their provenance stay with data; the bundle
contract lives in packages/contracts. This app has no editorial API.

The default preview uses a separate deterministic port/origin from the public app, preserving that app's service worker
and offline caches. The editor's own worker keeps its caches under an `editor-` prefix and never touches another app's.
