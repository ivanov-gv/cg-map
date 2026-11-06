# Map core concept app

An intentionally small app importing only the public map-core entry. One map and a grid of controls expose camera and
teardown, satellite, published POI levels, relative projection, replaceable GeoJSON, hit testing and selection. It uses
real local map assets; no editor or public-app code is imported.

Run `make -C apps/core-demo dev` then open the printed local URL. The standalone artifact is `dist/core-demo`; it works
at root or under a URL prefix. `make verify PKG=apps/core-demo` builds and checks it, and `make -C apps/core-demo e2e`
runs tests/e2e on desktop and mobile.

Use the street/overview buttons to compare POI thresholds; select the green overlay, shift its point by 20 screen
pixels, replace it with a polygon, toggle it, then recreate the map. Errors and stalled startup remain visible. This app
has no service worker, search, live transport, source editing or export. Its purpose is to keep shared features
independently visible and reviewable, not to be another product interface.

Add a simple control here whenever core gains a capability. Assets retain their single source in packages/map-core and
data; the build copies them into separate artifacts. See [map-core](../../packages/map-core/README.md).

The default preview uses a separate deterministic port/origin from the public app, preserving its existing service
worker and offline caches. A deployed viewer also needs its own origin or a path outside the public worker scope.
