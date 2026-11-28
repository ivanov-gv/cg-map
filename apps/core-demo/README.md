# Map core concept app

An intentionally small app importing only the public map-core entry. One map and a grid of controls expose camera and
teardown, satellite, published POI levels, relative projection, replaceable GeoJSON, hit testing and selection. It uses
real local map assets; no editor or public-app code is imported.

Run `make -C apps/core-demo dev` then open the printed local URL. The standalone artifact is `dist/core-demo`; it works
at root or under a URL prefix. `make verify PKG=apps/core-demo` builds and checks it, and `make -C apps/core-demo e2e`
runs the journeys in e2e/ on desktop and mobile. Unit tests sit beside the src/ and tools/ files they check; pinned
core, data and contract helpers and their tests stay in tests/ because platform's pin checks name that folder. Lint uses
this app's own `eslint.config.mjs`, so its source, tools, unit tests, journeys and config are checked from this folder.

## Build inputs

Plain `make -C apps/core-demo build`, `dev` and the ci-publish image/Pages builds take map-core, data and contracts from
the checked-out commit, so `/core-demo/` previews everything on main. `make verify PKG=apps/core-demo`, its test targets
and `make -C apps/core-demo e2e` build from the exact pins in [package.json](package.json); the browser configuration
sets the same core, data and contracts pins. `make -C apps/core-demo build-release` takes exactly those pins and refuses
another core, data or contracts root. Core-demo pins map-core's workspace `0.0.0-dev` because it is core's dev
environment, so its tests and release build follow core HEAD until a core release is published
([ADR 0046](../../docs/decisions/0046-editor-builds-take-their-own-core.md)).

Use the street/overview buttons to compare POI thresholds; select the green overlay, shift its point by 20 screen
pixels, replace it with a polygon, toggle it, switch it to the Editable state, then recreate the map. Errors and stalled
startup remain visible. This app has no service worker, search, live transport, source editing or export. Its purpose is
to keep shared features independently visible and reviewable, not to be another product interface.

The POI visibility card resolves two version-5 samples that have no stored level. One follows the exact kind rule in the
data-owned [place visibility policy](../../data/sources/place-visibility-policy.json), and one carries a
`visibilityOverride`. The card states each resolved level and zoom threshold; each button moves the map to its sample at
that threshold. The samples sit outside the default view, so today's map looks unchanged until a button is used.

Add a simple control here whenever core gains a capability. Assets retain their single source in packages/map-core and
data; the build copies them into separate artifacts. See [map-core](../../packages/map-core/README.md).

The default preview uses a separate deterministic port/origin from the public app, preserving its existing service
worker and offline caches. A deployed viewer also needs its own origin or a path outside the public worker scope.
