# Map core

ES-module runtime published as `@ivanov-gv/map-core` to GitHub Packages. The public map and source editor pin a release;
the concept demo uses this folder, so it always shows unreleased work. Import the package's public
[src/index.js](src/index.js) entry; inject MapLibre, archive transport, a container and the artifact's asset base URL.

It owns common cartography, category symbols and visibility policy, satellite imagery, map lifecycle, projection and
hit-testing helpers, and replaceable GeoJSON/selection overlays. It has no application screens, search, routes, storage,
service worker, editor modes or writes. See [architecture](../../docs/system-architecture/architecture.md).

## Cartography

`mapStyle` draws the basemap as designed on the wiki page
[UI 3.Core](https://github.com/ivanov-gv/cg-map/wiki/UI---3.Core) and the Penpot card "7 · Map primitives (Core)".
[src/basemap-palette.js](src/basemap-palette.js) holds one colour token per primitive part.
[src/drawing-order.js](src/drawing-order.js) lists the drawing groups bottom to top; every basemap layer records its
group in `metadata`, and a unit test fails when a layer is out of order. The final order is `land` → `shades` →
`shaded-slopes` → `sunlit-slopes` → `canyon-walls` → `canyon-rims` → `water` → `buildings` → `meadows` → `contour-lines`
→ `railways` → `streets` → `trails` → `main-routes` → `stairways` → `bridges` → `bridge-streets` → `bridge-trails` →
`bridge-main-routes` → `bridge-stairways` → `labels` → `points-of-interest`. Ground roads stay above railways and below
decks; roads on bridges stay above decks. Applications install points of interest after the style; both apps place them
below street labels today.

Canyon walls are nested bands offset from each canyon rim toward the water, using the relief rule that rims run with the
river on their right. A painted `width` is ground metres at one constant scale, 1.1393 px/m at zoom 16, doubling at each
zoom. An empty or zero width draws as 10 px at zoom 16 with the same doubling, but never thinner than 2 px for the whole
wall at low zoom; a painted width narrower than that no-width edge draws as the no-width edge. Their colour goes from
lightest at the rim to darkest at the foot, using the full depth range at 9 m or more, a shorter lighter range below,
and the full range when `height` is absent. Each outline in the `bridges` tile layer draws one grey deck for that
crossing, with a dark line on its edge. Decks sit above water, canyon, railways, ground and roads at or below ground
level, including roads passing under the bridge. Only roads whose own `bridge` tag or positive `layer` puts them on a
bridge are drawn above the deck. Tunnels stay below decks even with a positive `layer`, and a negative `layer` keeps a
bridge-tagged road with ground roads; the style has no tunnel-specific drawing. Each road kind has a ground layer and a
matching `-on-bridge` layer above the decks. An application that hit-tests roads by layer id must pass its base
line-layer ids to `roadLayerIds([...])`, which returns each id and its `-on-bridge` copy; a hardcoded list misses roads
on bridges. Label layers and already-suffixed ids fail with `Unknown road layer` rather than being added twice.

The `railways` tile layer draws platforms as light fills or narrow strokes, active tracks as a thin, soft grey bed with
fine dashed ties, and disused tracks as one faint dashed line. Their greys sit near land and minor-road casings, so
tracks stay quiet against both. Track and platform widths grow with zoom. Stations and halts use a generated rail badge
and a name label in the labels group, with the same local font as other labels; the style has no sprite, so `createMap`
installs the badge on demand. Railways sit above land use but below ground roads, as they did before the bridge split; a
road crossing a track covers it. The tile layer carries no `bridge` or `layer` field, so the style has no `-on-bridge`
railway copy and no way to raise a track above a deck. Station names remain in the labels group above roads.

The `water` fill paints every polygon in the `water` tile layer with the open-water tone, including the stored sea
polygon with `kind: sea` from the version-5 surface data. Its filter is already kind-agnostic, so publishing the sea
needs no style change; coastline lines stay separate and get no river stroke.

Hills use the relief layers inside green areas: a shaded and a sunlit tone, a summit triangle with "Name · height m",
and park names along the `green_area_labels` lines. The `shades` layer paints stored shade polygons from the `shades`
tile layer (`kind: shade`) with the shaded tone, over green areas and below roads. The `slopes` and `ridges` layers stay
while today's archive still publishes them; no shade feature exists yet, so the map looks unchanged until data switches.
`createMap` adds the summit triangle when the style first asks for it, since the style has no sprite.

Contours in today's `contours` tile layer stay one faint type every 20 m. Version 5 merges contours and summits into
`relief`; its layers select line geometry and derive the index from the feature's own `elevation`: lines divisible by
100 m are bold, the rest thin. Their heights are labels along each line, kept un-flipped: the relief contract runs every
contour with higher ground on its left, so the digits face uphill. MapLibre spaces the labels along each line; the
wiki's single column down a hill's sunlit slope is not reproduced. The `relief` layers match no feature in today's
archive, so nothing changes there.

Settlement labels read version-5 points in `settlements`: a feature needs its own `place`, and its text size comes from
`place` and `population`: city 13 px, town 11 px, village 9 px, smaller places 8 px. A higher population promotes a
place to the next band. Today's points carry `rank` but no `place`, so `settlement-labels` draws none; the public app's
existing city-name layer still supplies those labels. The rules are in
[src/settlement-layers.js](src/settlement-layers.js).

Walking paths are drawn by what they are to a walker: stored `pathClass: park` as a cream path over a casing,
`pathClass: trail` and `pathClass: city` as quiet round dots, and stairways with a step pattern. Today's tiles store
`main` instead of `park`/`city`, so a main path still uses `inGreenArea` to pick its pattern, and a path with no class
still uses the trail pattern; those are the only legacy fallbacks. Meadows fill only land areas with the `destination`
flag. The park routes are new layers, `park-route-casing` and `park-routes`: an application that hit-tests walking paths
by layer id adds them when it upgrades.

POI symbols come from the feature's own `kind`, with the kind-to-category table in
[src/place-category.js](src/place-category.js). The three kinds that occur in two categories today (`fuel`, `hotel`,
`yes`) keep reading a stored `category` when one is present, so their current symbols stay; the rest ignore that legacy
field. Marker identity, co-location groups, tap hits and `activeIds` use `entityId`; apps/web and apps/core-demo still
pin data 0.1.0, whose places have no `entityId`, so a POI without one uses its legacy `id`. apps/editor pins 0.2.0,
which already publishes `entityId`.

## Lifecycle

`createMap` installs navigation, scale, frame-scheduled resizing, house-number scale handling and the local satellite
sources. Call `whenMapReady` before installing overlays or POIs; handle its rejection and the map's `error` events
visibly. Dispose with `map.remove()`; the core disconnects its resize observer and number-scale listeners.
`registerArchiveProtocol` takes the vendored PMTiles module and, optionally, an archive source for the public app's
offline adapter. The caller owns archive/offline policy.

`createGeoJSONOverlay` renders mixed points, lines and polygons and holds an independent selection source. The overlay
starts in the Default state and `setState('editable')` switches it to the Editor's thin green outline; the selection is
always drawn Highlighted, a red outline over a light red fill, from the Penpot primitives card. It accepts GeoJSON
without changing caller-owned features, and `setSelection` also accepts `hitTest` results. Rendered geometry is clipped
to tile boundaries, so pass source features when a large polygon must highlight whole. Source editing, source identity
and cross-file validation belong to the editor and data tooling, not this rendering helper. `installPlaces` uses the
same policy and palette as the public app; public search/selection orchestration stays in the public app.

assets/ holds the vendored MapLibre and PMTiles bundles and fonts. tools/assemble.mjs is the build-time half of the
contract: each application's own build tool uses it to copy the runtime, assets and verified map data into its artifact.
It leaves `*.test.js` out of artifacts, and `npm pack` leaves them out of the published package while keeping the
`src/*`, `tools/*` and `assets/*` paths its consumers import.

Local `make verify PKG=packages/map-core` is optional for iterating; GitHub's map-core and consumer pipelines gate the
merge. Open the independent [concept app](../../apps/core-demo/README.md) to inspect features visually while iterating.
Builds relocate the package imports and copy one maintained runtime into each independent artifact; the public offline
manifest inventories those modules too. New shared capabilities need a concept control and appropriate tests.

Next extractions can move remaining app-specific selection policy behind an explicit adapter when both consumers need
it. Avoid growing core with editor commands or public-app state.
