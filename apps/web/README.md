# cg-map frontend: implementation walkthrough

A code-level walkthrough of the deployed application: module responsibilities, state transitions, rendering, storage and publication. See [ARCHITECTURE.md](../../ARCHITECTURE.md) for broader design decisions and alternatives.

## 1. Runtime boundaries

| Context | Code | Responsibility |
| --- | --- | --- |
| Browser main thread | app.js, core.js, map-style.js, satellite.js, offline.js | UI state, event handlers, map configuration and archive access |
| MapLibre internals | vendor/maplibre-gl.js and its workers | Tile preparation, label placement and WebGL rendering |
| Service-worker context | sw.js, offline-manifest.js | Serve cached application assets and manage shell-cache lifecycle |
| Build process | tools/ plus ../../data/ | Assemble the web artifact and generate offline manifests; data owns tile generation |
| Static host | GitHub Pages | Serve the verified dist/web artifact directly at /cg-map/, including archive byte ranges |

The browser keeps one MapLibre instance alive. Search, selection and layer switching update existing DOM elements and map sources/layers. There is no per-interaction backend request.

Application handlers share the browser main thread. Tile work managed by MapLibre does not make filtering or rebuilding result lists free; avoid expensive application work during gestures.

## 2. A useful reading order

| File | Read it to understand |
| --- | --- |
| [index.html](public/index.html) | Which controls exist and their IDs |
| [style.css](public/style.css) | Desktop/mobile layout, positioning and visual states |
| [core.js](src/core.js) | Small data functions: search, distances, category definitions |
| [app.js](src/app.js) | Startup, state, UI handlers, results, markers, place cards |
| [map-style.js](src/map-style.js) | Vector basemap sources, layers, colors and labels |
| [satellite.js](src/satellite.js) | The bounded raster sample and its visibility switch |
| [offline.js](src/offline.js) | Archive transport, verified downloads and local file reads |
| [sw.js](src/sw.js) | Offline file requests, shell caches and worker lifecycle |
| [offline-manifest.js](tools/finalize.mjs) | Generated list of files for the service worker |
| [data/manifest.json](tools/finalize.mjs) | Generated archive URL, size, hash and offline inventory |
| [manifest.webmanifest](public/manifest.webmanifest) | Installation name, icons, start URL and scope |
| vendor/ | Bundled MapLibre and PMTiles libraries; do not hand-edit them |

Application modules load directly as browser ES modules; vendor bundles are committed separately.

## 3. What happens when the page opens

1. The browser parses index.html and creates its DOM.
2. It loads CSS and the bundled MapLibre/PMTiles scripts.
3. It evaluates app.js as an ES module, resolving its imports.
4. Module-level code creates category buttons and registers UI handlers.
5. start() begins asynchronous initialization.
6. It rejects file:/content: opening and checks that vendor libraries loaded.
7. It fetches data/manifest.json and data/places.geojson.
8. It assigns session feature IDs and builds byId, keyed by the original place ID.
9. It registers the service worker where supported in a secure context.
10. ArchiveSource.init() checks for an activated local archive in OPFS.
11. It registers the PMTiles protocol with MapLibre.
12. It creates one MapLibre Map using mapStyle(), initially over Podgorica.
13. It adds navigation controls and a ResizeObserver.
14. When MapLibre emits load, it installs satellite sources, place layers, the selected-place overlay and city labels.
15. It enables the satellite button, hides the loading message and builds the result list.

MapLibre's load event is not a guarantee that every later camera position, hidden image or future tile is already loaded. The renderer continues requesting data as needed.

The top-level start().catch(...) handler displays startup errors. Later map errors use a separate map event handler.

## 4. Where application state lives

app.js currently uses module variables instead of a state-management library:

| Variable | Meaning |
| --- | --- |
| map | The single long-lived MapLibre instance |
| all | Complete loaded place array |
| filtered | Places matching current text/category |
| byId | Lookup from place ID to feature |
| category | Active category key |
| selected | Selected place, or null |
| satelliteVisible | Whether the two satellite layers are shown |
| archive / manifest | Archive reader and downloaded dataset metadata |
| loaded | Whether application map-layer setup completed |
| downloadAbort | Active download's cancellation controller |
| returnFocus | Element to focus when closing place details |

Changing a variable alone does not update the screen. The handler must also update DOM elements and/or MapLibre data.

There is no automatic React-style reconciliation. Read each handler as a short transaction: change state, update the affected views, and restore a usable focus/state.

## 5. Search: follow one event end to end

Suppose the user types "museum".

1. The search input emits an input event.
2. Its handler cancels the previous timer.
3. It schedules filterPlaces() after 120 ms without another input event.
4. filterPlaces() calls matches() on all places using the current category.
5. matches() normalizes text: lower case, diacritic folding and supported Cyrillic transliteration.
6. Search checks name, name:en, kind and addr:street.
7. It assigns the resulting array to filtered.
8. If the map is ready, it calls setData() on the places GeoJSON source.
9. It closes the current place card if that place no longer matches.
10. renderResults() sorts matching places by approximate distance from the map center and creates up to 40 result buttons.

This is substring search over an in-memory dataset. It is not fuzzy search, a full-text index or a server request.

Distance is an approximation in kilometers from the map center, not a route length or necessarily distance from the user.

Selecting a category updates category and calls the same filterPlaces() path.

Panning calls renderResults() on moveend. It changes nearest ordering, not the text/category filters. It does not restrict the search dataset to the visible rectangle.

## 6. Two rendering systems share the screen

The browser displays ordinary HTML controls. MapLibre draws the geographic scene into a canvas.

A result button is a DOM element. A place circle is a feature drawn by a MapLibre layer; it is not an individual HTML button.

This distinction keeps thousands of map features out of the DOM.

### Sources contain data; layers describe drawing

Sources hold geometry or imagery. Layers apply rendering rules to a source; changing a layer does not replace its data.

One places source is rendered by several layers:

| Layer | Purpose |
| --- | --- |
| clusters | Circle representing several nearby places |
| cluster-count | Number inside the cluster |
| place-circles | Individual place markers |
| place-names | Individual place labels |

The selected source contains zero or one feature. selected-halo draws its highlight.

The basemap source is vector tiles. Its source-layer fields refer to named datasets inside each tile, such as roads and buildings. A MapLibre layer ID and an MVT source-layer name are different identifiers.

### Camera movement

MapLibre owns pan/zoom gestures, projection, tile selection and rendering. The app asks it to move using easeTo() or fitBounds().

Do not destroy and recreate map when switching a category, showing details or changing layer visibility. That would throw away camera state and rendering resources.

### Map style expressions

In map-style.js, arrays such as interpolate and match are MapLibre expression syntax. They describe zoom-dependent widths, colors and filters; they are not JavaScript function calls.

CSS does not set vector-road colors. Change map-style.js for cartography and style.css for HTML controls.

## 7. Selecting and closing a place

Map clicks use queryRenderedFeatures() on the marker/cluster layers.

- A cluster click asks MapLibre for an expansion zoom, then moves the camera.
- An individual marker click passes the place ID to showPlace().
- A background click closes the card.
- A result-list button calls showPlace() directly.

showPlace():

1. Looks up the feature in byId.
2. Stores selected and the originating control, when supplied.
3. Fills card text and safe links.
4. Shows the existing card element.
5. Updates the selected GeoJSON source.
6. Moves the camera to the place.
7. Focuses the close button.

closePlace() clears the feature, hides the card, empties the highlight source and restores focus when possible. Escape also closes the mobile results panel.

This is all local interaction with already loaded data. No detail endpoint is called.

## 8. How the satellite switch works

satellite.js installs two sources and two raster layers, initially hidden:

1. satellite-preview: one georeferenced WebP mosaic of the whole sample.
2. satellite-tiles: the original 16 XYZ tiles at native zoom 17.

The preview remains beneath the detailed tiles. It covers the footprint at lower zooms and while native tiles load.

Both layers are inserted before road-labels. Existing road labels and the place layers remain above the photographs. Outside the small image footprint the vector basemap remains visible.

Clicking Satellite:

- Toggles satelliteVisible.
- Changes layer visibility rather than replacing the map/style.
- Updates the button text and aria-pressed state.
- Shows the coverage/source note.
- Centers on the sample at zoom 17.5 when enabling it.

Clicking Street map hides the imagery; it does not reset the camera.

The sample covers roughly 900 × 900 meters, not all Podgorica. Further zoom magnifies the existing photos. MapLibre can draw raster imagery and vector geometry together; the photographs do not make vector buildings blurry.

The app requests bundled local files, not eMapa at runtime. Source URLs and licensing uncertainty are recorded separately in data/satellite/.

## 9. Coordinate order: an easy mistake

GeoJSON and the MapLibre calls used here use:

~~~js
[longitude, latitude]
[19.26, 42.437] // Podgorica
~~~

This is the reverse of many human-readable GPS displays. showPlace() reverses a copy only to print latitude/longitude in the card.

Bounds are:

~~~js
[west, south, east, north]
~~~

MapLibre image corners are ordered top-left, top-right, bottom-right, bottom-left.

Do not copy Leaflet's usual latitude/longitude argument order into these MapLibre/GeoJSON structures.

## 10. Offline is split across several browser stores

| Store | Contents | Owner |
| --- | --- | --- |
| Cache Storage | HTML, scripts, CSS, places, fonts, icons, satellite assets | Service worker and download code |
| OPFS | Complete PMTiles archive | ArchiveSource |
| localStorage | Small active-archive filename marker | ArchiveSource |
| Memory | Current state, tile cache, optional whole-archive Blob | App / MapLibre / archive reader |

A service worker is a separate browser-managed JavaScript context. It cannot edit the page DOM. Here it intercepts eligible same-origin file requests and serves cached responses.

### Normal online map reads

ArchiveSource.getBytes() supplies byte ranges to the PMTiles library:

- If an activated local archive exists, read a local file slice.
- Otherwise test HTTP range support.
- If the server returns 206, continue using partial remote reads.
- If it ignores Range and returns the whole archive, retain a Blob and slice it in memory.

That online Blob is not a persistent offline download.

### Explicit Download offline

The download workflow:

1. Requires the active service worker and OPFS support.
2. Checks estimated free storage.
3. Fetches and caches all listed shell assets, including satellite files.
4. Streams the vector archive into a .partial file.
5. Verifies its size and SHA-256.
6. Copies it to the final file.
7. Writes the active-map marker last.
8. Requests persistent storage where supported and removes the temporary file.

Cancellation uses AbortController. The new archive is not activated before verification. This does not provide full atomic rollback across every shell/cache/release component.

### Why old UI can survive a deployment

The service worker normally serves cached assets first. A new worker may install but wait until old controlled tabs close. Refreshing an open tab does not always activate the new release.

For ordinary updates, close all cg-map tabs and reopen. During development, Chrome DevTools → Application lets you inspect service workers and caches. Clearing site data is a diagnostic last resort: it removes downloaded maps too.

The current "Exploring offline" / READY state mainly reflects the activated local vector archive. It is not proof that the device has no network, every cache is intact, or storage can never be evicted.

HTTPS or localhost is required for the relevant offline APIs. Opening index.html directly is unsupported.

## 11. Resizing and mobile behavior

ResizeObserver watches the map container. The callback cancels an earlier scheduled resize and schedules map.resize() through requestAnimationFrame().

This lets MapLibre update its canvas when the real container dimensions change, for example during rotation. It does not rebuild map sources or tiles.

On mobile, the result list is a panel controlled through a CSS class, results-open, and aria-expanded. Selecting a result hides that list and shows the details card over the map.

When changing mobile CSS, test rotation, keyboard opening, long place names, scrolling and closing panels. A desktop window made narrow does not reproduce an Android GPU or browser lifecycle.

## 12. How to make common changes

| Goal | Start here | Follow-up |
| --- | --- | --- |
| Change button wording | index.html or app.js, depending on who creates it | Regenerate offline manifests |
| Change sidebar/card spacing | style.css | Check desktop and mobile |
| Change road/building colors | map-style.js | No geometry rebuild needed |
| Change marker colors | colors in core.js | Check list icons and map |
| Change search fields/rules | matches() in core.js | Add a meaningful search regression test |
| Change result limit | selectNearest() in core.js | Consider list cost/usability |
| Change initial center/zoom | Map constructor in app.js | Test cold startup |
| Add a card field | showPlace() in app.js and place properties | Use textContent and safe links |
| Add/edit a place | ../../data/sources/places.geojson | Review count-based tests and regenerate manifests |
| Change building footprint | ../../data/sources/buildings.geojson | Rebuild vector tiles, then publish |
| Expand satellite coverage | satellite.js, original tiles, preview, provenance | Keep bounds, corners and tile inventory consistent |
| Change offline assets | tools/finalize.mjs | Regenerate both manifests |

A new module imported by app.js must also be added to the shell list in finalize.mjs. The current tooling does not discover JavaScript imports automatically.

## 13. Local development and publication

The source layout separates src/ runtime modules, public/ static assets, tools/ assembly, and tests/. The built runtime is flat inside dist/web, so the module URLs described above are unchanged.

Run commands from repository root:

~~~sh
make setup
make dev
make check
make test-e2e
~~~

make dev builds the app and serves dist/web on localhost:8080. Rebuild after edits; there is no hot reload. The build consumes reviewed data/artifacts, data/sources/places.geojson, and data/imagery without regenerating geography. Offline manifests exist only in dist/web.

Geometry changes require make build-data with its optional Python dependencies. UI changes need only a web build. GitHub Actions validates and publishes dist/web on main. Do not commit built output. See [release](../../docs/runbooks/release.md) and [data](../../docs/runbooks/data.md).

## 14. Debugging with browser DevTools

The app exposes window.kompasDebug for inspection:

~~~js
window.kompasDebug.placeCount
window.kompasDebug.selected
window.kompasDebug.satellite
window.kompasDebug.offline
window.kompasDebug.map.getCenter()
window.kompasDebug.map.getZoom()
window.kompasDebug.map.getStyle().layers.map(layer => layer.id)
~~~

The geographic map handle is available only after successful map construction. Debug inspection is not a replacement for testing what users see.

Common symptoms:

| Symptom | Check first |
| --- | --- |
| Old UI after deployment | Service worker waiting/cached release |
| Satellite button remains disabled | Map startup failed or load did not finish |
| WebGL initialization error | Browser/device graphics support; this is before layer interaction |
| Satellite disappears outside a rectangle | Expected sample coverage |
| Photos blur at very high zoom | Native raster resolution |
| New script fails only offline | Missing shell entry or stale manifests |
| Fonts/labels missing | Glyph URL, requested character blocks and network responses |
| Blank map after layout change | Container dimensions and map.resize() |
| Place exists but is absent from list | Text/category filter or nearest-40 limit |
| Download fails after changing files | Stale manifest, incomplete assets, quota or integrity mismatch |

Observe the actual error before changing rendering code. A 404, stale cached script, disabled WebGL and malformed geometry need different fixes.

## 15. What tests prove, and what they do not

The repository currently has 22 Node tests covering archive decoding/style validity, search, link safety, download transactions, service-worker responses, HTTP transport fallback and satellite configuration/assets. There are also Python server tests and an optional browser script in ../tests/browser-check.mjs.

Unit tests can prove a generated style is valid or original tile hashes match. They cannot prove a phone's pinch zoom is smooth, a GPU draws the expected pixels, or an offline browser retains files indefinitely.

For a UI change, manually check:

- Initial page load with a fresh session.
- Search, category changes, place selection and closing.
- Satellite → Street map, panning beyond sample coverage and zooming.
- Mobile-sized layout and real-device rotation.
- Offline download followed by reopening without a connection.
- An existing installation receiving a new release.

The latest cloud-browser inspection could not render because that browser disables WebGL. Do not interpret it as a successful visual test of the satellite layer.


## Optional transport

[transport.js](src/transport.js) installs static stop circles/names and live vehicle circles/route labels. Transport visibility controls both, while only vehicle positions are cleared during offline/hidden/error states. Stop selection in app.js uses text nodes in a MapLibre popup. The build copies the reviewed stop snapshot into the offline shell; live vehicle responses are never cached there. See [transport behavior](../../docs/transport.md).

## Point selection

[point-selection.js](src/point-selection.js) describes clicked features and installs the A/B endpoint layers. app.js presents the shared details card and stores From/To session state. See [point selection](../../docs/point-selection.md) for hit priority, available metadata, and offline behavior.
