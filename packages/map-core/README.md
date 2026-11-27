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
group in `metadata`, and a unit test fails when a layer is out of order. Applications install points of interest after
the style; both apps place them below street labels today.

Canyon walls are nested bands offset from each canyon rim toward the water, using the relief rule that rims run with the
river on their right. A painted `width` is ground metres at one constant scale, 1.1393 px/m at zoom 16, doubling at each
zoom. An empty or zero width draws as 10 px at zoom 16 with the same doubling, but never thinner than 2 px for the whole
wall at low zoom; a painted width narrower than that no-width edge draws as the no-width edge. Their colour goes from
lightest at the rim to darkest at the foot, using the full depth range at 9 m or more, a shorter lighter range below,
and the full range when `height` is absent. Each outline in the `bridges` tile layer draws one grey deck for that
crossing, with a dark line on its edge. Decks sit above water, canyon, ground and roads at or below ground level,
including roads passing under the bridge. Only roads whose own `bridge` tag or positive `layer` puts them on a bridge
are drawn above the deck. Tunnels stay below decks even with a positive `layer`, and negative layers stay with ground
roads; the style has no tunnel-specific drawing. Each road kind has a ground layer and a matching `-on-bridge` layer
above the decks. An application that hit-tests roads by layer id must pass its base line-layer ids to
`roadLayerIds([...])`, which returns each id and its `-on-bridge` copy; a hardcoded list misses roads on bridges. Label
layers and already-suffixed ids fail with `Unknown road layer` rather than being added twice.

The `railways` tile layer draws platforms as light fills or narrow strokes, active tracks as a thin, soft grey bed with
fine dashed ties, and disused tracks as one faint dashed line. Their greys sit near land and minor-road casings, so
tracks stay quiet against both. Track and platform widths grow with zoom. Stations and halts use a generated rail badge
and a name label in the labels group, with the same local font as other labels; the style has no sprite, so `createMap`
installs the badge on demand. Railways sit above land use, bridge decks and ground roads, but below roads on bridges.

Hills use the relief layers inside green areas: a shaded and a sunlit tone, a summit triangle with "Name · height m",
and park names along the `green_area_labels` lines. `createMap` adds the summit triangle when the style first asks for
it, since the style has no sprite.

Contour lines are one faint type every 20 m. Their heights are labels along each line, kept un-flipped: the relief
contract runs every contour with higher ground on its left, so the digits face uphill. MapLibre spaces the labels along
each line; the wiki's single column down a hill's sunlit slope is not reproduced.

Walking paths are drawn by what they are to a walker: park routes (main paths with `inGreenArea`) as a cream path over a
casing, trails and city footpaths as quiet round dots, stairways with a step pattern. Meadows fill only land areas with
the `destination` flag. The park routes are new layers, `park-route-casing` and `park-routes`: an application that
hit-tests walking paths by layer id adds them when it upgrades.

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
