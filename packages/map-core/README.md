# Map core

ES-module runtime published as `@ivanov-gv/map-core` to GitHub Packages. The public map and source editor pin a release;
the concept demo uses this folder, so it always shows unreleased work. Import the package's public
[src/index.js](src/index.js) entry; inject MapLibre, archive transport, a container and the artifact's asset base URL.

It owns common cartography, category symbols and visibility policy, satellite imagery, map lifecycle, projection and
hit-testing helpers, and replaceable GeoJSON/selection overlays. It has no application screens, search, routes, storage,
service worker, editor modes or writes. See [architecture](../../docs/system-architecture/architecture.md).

`createMap` installs navigation, scale, frame-scheduled resizing, house-number scale handling and the local satellite
sources. Call `whenMapReady` before installing overlays or POIs; handle its rejection and the map's `error` events
visibly. Dispose with `map.remove()`; the core disconnects its resize observer and number-scale listeners.
`registerArchiveProtocol` takes the vendored PMTiles module and, optionally, an archive source for the public app's
offline adapter. The caller owns archive/offline policy.

`createGeoJSONOverlay` renders mixed points, lines and polygons and holds an independent selection source. It accepts
GeoJSON without changing caller-owned features, and `setSelection` also accepts `hitTest` results. Rendered geometry is
clipped to tile boundaries, so pass source features when a large polygon must highlight whole. Source editing, source
identity and cross-file validation belong to the editor and data tooling, not this rendering helper. `installPlaces`
uses the same policy and palette as the public app; public search/selection orchestration stays in the public app.

assets/ holds the vendored MapLibre and PMTiles bundles and fonts. tools/assemble.mjs is the build-time half of the
contract: each application's own build tool uses it to copy the runtime, assets and verified map data into its artifact.

Run `make verify PKG=packages/map-core`. Open the independent [concept app](../../apps/core-demo/README.md) to inspect
features visually. Builds relocate the package imports and copy one maintained runtime into each independent artifact;
the public offline manifest inventories those modules too. New shared capabilities need a concept control and
appropriate tests.

Next extractions can move remaining app-specific selection policy behind an explicit adapter when both consumers need
it. Avoid growing core with editor commands or public-app state.
