# Frontend guide for a backend / Go developer

This guide explains the actual read-only cg-map frontend, including the satellite sample. Start here before reading the longer [architecture guide](../ARCHITECTURE.md). Examples refer to the current implementation, not a proposed React application or future backend.

## 1. What runs where

The production server is GitHub Pages. It sends files; it does not execute our Go, Python, or JavaScript application logic.

The browser downloads HTML, CSS, JavaScript and map data. It then runs the application on the user's device:

- HTML defines controls and containers.
- CSS decides their appearance and layout.
- JavaScript handles events, stores state and changes the interface.
- MapLibre renders geographic data into a WebGL canvas.
- Browser storage retains explicitly downloaded offline content.

JavaScript also runs in our build tools through Node.js, but that is a different process at a different time. A visitor does not run npm or rebuild tiles.

| Familiar backend concept | Closest frontend equivalent here |
| --- | --- |
| Program entry point | app.js module evaluation, followed by start() |
| Request handler | A callback registered for a button, input or map event |
| In-memory service state | Module variables such as category, filtered and selected |
| Template / response representation | The DOM tree created from HTML |
| Updating a response | Updating an existing DOM element or MapLibre source |
| Static configuration | map-style.js and satellite.js |
| Background infrastructure | MapLibre's rendering machinery and the service worker |
| Persistent local files | OPFS, scoped to the website's origin |

The analogy has limits: the UI is a long-lived process. A click normally changes the current page instead of requesting a new HTML page from a backend.

## 2. A useful reading order

| File | Read it to understand |
| --- | --- |
| [index.html](index.html) | Which controls exist and their IDs |
| [style.css](style.css) | Desktop/mobile layout, positioning and visual states |
| [core.js](core.js) | Small data functions: search, distances, category definitions |
| [app.js](app.js) | Startup, state, UI handlers, results, markers, place cards |
| [map-style.js](map-style.js) | Vector basemap sources, layers, colors and labels |
| [satellite.js](satellite.js) | The bounded raster sample and its visibility switch |
| [offline.js](offline.js) | Archive transport, verified downloads and local file reads |
| [sw.js](sw.js) | Offline file requests, shell caches and worker lifecycle |
| [offline-manifest.js](offline-manifest.js) | Generated list of files for the service worker |
| [data/manifest.json](data/manifest.json) | Generated archive URL, size, hash and offline inventory |
| [manifest.webmanifest](manifest.webmanifest) | Installation name, icons, start URL and scope |
| vendor/ | Bundled MapLibre and PMTiles libraries; do not hand-edit them |

There is no frontend framework, JSX, TypeScript compiler, component framework or JavaScript bundler for our application modules. The vendor libraries are already distributed as browser bundles.

Some source files are densely formatted. Use your editor's formatting preview or format deliberately in a separate change; formatting and behavior changes are easier to review separately.

## 3. HTML, DOM and CSS

### HTML describes the initial interface

index.html contains a sidebar, search box, category container, results container and map area. It also contains initially hidden place details and error panels.

For example, an element with an ID can be found by JavaScript:

~~~html
<input id="search" type="search" aria-label="Search places">
~~~

~~~js
document.getElementById('search')
~~~

The DOM, or Document Object Model, is the browser's in-memory tree of these elements. Editing a DOM object changes the existing page.

app.js defines a shorthand:

~~~js
const $ = id => document.getElementById(id);
~~~

Here, $ is an ordinary function name. This project does not use jQuery.

### CSS supplies layout and visual states

A CSS selector identifies elements to style:

~~~css
.place-card { /* every element with this class */ }
#map { /* the element with this ID */ }
~~~

The application uses a grid with a sidebar and map on desktop. At viewport widths up to 720 pixels, a media query switches to a compact mobile layout.

The map container stays in place. Place details and map controls are positioned over it; opening a card does not reconstruct or deliberately resize the map.

Important properties to recognize:

| CSS property | Meaning in this application |
| --- | --- |
| display: grid / flex | Arrange child elements |
| position: relative | Establish a positioning reference for descendants |
| position: absolute | Place a child relative to its positioned ancestor |
| inset: 0 | Stretch to all four edges |
| z-index | Control stacking where applicable |
| overflow: auto | Scroll content that does not fit |
| pointer-events: none | Let pointer input pass through a container |
| pointer-events: auto | Let an actual control receive input |
| [hidden] | Hide panels until JavaScript enables them |

Do not apply broad pointer-event or z-index changes blindly: a visible map button can become unclickable if an invisible overlay intercepts input.

### Attributes communicate behavior and accessibility

The app changes hidden, disabled, aria-pressed, aria-expanded and aria-current.

For example, aria-pressed exposes the satellite button's state to assistive technologies. It is also used by CSS to choose its active appearance.

Use textContent for untrusted place names. Assigning untrusted text through innerHTML would make the browser interpret it as markup. The current card/list construction uses text nodes; safeWebsite() also restricts external website links to HTTP(S).

## 4. The JavaScript you need to read this code

| Syntax | Meaning |
| --- | --- |
| const value = ... | Binding cannot be reassigned; an object it references can still change |
| let value = ... | Binding can be reassigned |
| {name: 'Cafe'} | Object with named properties |
| [a, b] | Array |
| (value) => expression | Function expression, often an event callback |
| export / import | Expose and consume module bindings |
| === | Strict equality; prefer it over coercing equality |
| null | Explicitly absent value |
| undefined | Missing/unassigned value |
| object?.field | Read only if object is not null/undefined |
| value ?? fallback | Use fallback only for null/undefined |
| ...object | Spread properties into another object |
| array.map(fn) | Produce a new array by transforming each element |
| array.filter(fn) | Produce a new array containing matching elements |
| new Map() | Key/value lookup structure, not a geographic map |

For example, this creates a new array of places in a category:

~~~js
const cafes = all.filter(feature => feature.properties.category === 'food');
~~~

A JavaScript object is somewhat like a Go struct with runtime-defined fields. It has reference semantics: two bindings can refer to the same object.

### Promises, async and await

A Promise represents a result that will become available later.

~~~js
const response = await fetch('data/places.geojson');
if (!response.ok) throw new Error('Could not load places');
const data = await response.json();
~~~

fetch() retrieves bytes over HTTP. response.json() parses the body. HTTP 404 does not automatically reject fetch(), so checking response.ok matters.

await pauses the current async function, not the whole browser. Other events and rendering can proceed. It does not turn CPU-heavy JavaScript into background work.

Promise.all() starts independent work together and waits for all results. Startup uses it to fetch the data manifest and places concurrently.

### The event loop

Ordinary DOM handlers and our application JavaScript run on the main browser thread. Long synchronous code blocks input and painting. They do not run as separate goroutines just because multiple handlers exist.

MapLibre manages additional work internally, including workers, but that does not make arbitrary application code parallel.

setTimeout() schedules a later callback; it is not a precise timing guarantee. requestAnimationFrame() schedules work around a future repaint opportunity.

## 5. What happens when the page opens

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

## 6. Where application state lives

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

## 7. Search: follow one event end to end

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

## 8. Two rendering systems share the screen

The browser displays ordinary HTML controls. MapLibre draws the geographic scene into a canvas.

A result button is a DOM element. A place circle is a feature drawn by a MapLibre layer; it is not an individual HTML button.

This distinction keeps thousands of map features out of the DOM.

### Sources contain data; layers describe drawing

A source answers: "Which geometry/images do I have?"

A layer answers: "How should part of that source look?"

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

## 9. Selecting and closing a place

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

## 10. How the satellite switch works

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

## 11. Coordinate order: an easy mistake

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

## 12. Offline is split across several browser stores

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

## 13. Resizing and mobile behavior

ResizeObserver watches the map container. The callback cancels an earlier scheduled resize and schedules map.resize() through requestAnimationFrame().

This lets MapLibre update its canvas when the real container dimensions change, for example during rotation. It does not rebuild map sources or tiles.

On mobile, the result list is a panel controlled through a CSS class, results-open, and aria-expanded. Selecting a result hides that list and shows the details card over the map.

When changing mobile CSS, test rotation, keyboard opening, long place names, scrolling and closing panels. A desktop window made narrow does not reproduce an Android GPU or browser lifecycle.

## 14. How to make common changes

| Goal | Start here | Follow-up |
| --- | --- | --- |
| Change button wording | index.html or app.js, depending on who creates it | Regenerate manifests and docs |
| Change sidebar/card spacing | style.css | Check desktop and mobile |
| Change road/building colors | map-style.js | No geometry rebuild needed |
| Change marker colors | colors in core.js | Check list icons and map |
| Change search fields/rules | matches() in core.js | Add a meaningful search regression test |
| Change result limit | selectNearest() in core.js | Consider list cost/usability |
| Change initial center/zoom | Map constructor in app.js | Test cold startup |
| Add a card field | showPlace() in app.js and place properties | Use textContent and safe links |
| Add/edit a place | data/places.geojson | Review count-based tests and regenerate manifests |
| Change building footprint | ../source-data/buildings.geojson | Rebuild vector tiles, then publish |
| Expand satellite coverage | satellite.js, original tiles, preview, provenance | Keep bounds, corners and tile inventory consistent |
| Change offline assets | ../tools/finalize.mjs | Regenerate both manifests |

To add a simple button:

1. Give it a unique ID in HTML.
2. Register one click handler in app.js.
3. Update only the relevant state and DOM/map layer.
4. Set appropriate disabled/pressed state.
5. Check keyboard access.
6. Regenerate offline manifests and the Pages copy.

A new module imported by app.js must also be added to the shell list in finalize.mjs. The current tooling does not discover JavaScript imports automatically.

## 15. Local development and publication

Run commands from the repository root.

### First setup

~~~sh
npm ci --ignore-scripts
python3 server.py
~~~

Open http://localhost:8080/. Python serves the committed web assets; npm dependencies are used by build tools and tests, not a frontend development server. There is no automatic hot reload.

### After UI, style, place or satellite changes

~~~sh
node tools/finalize.mjs
node tools/publish-pages.mjs
npm test
~~~

finalize.mjs regenerates cache identity and manifests. It also reads/hashes the existing archive; it does not regenerate road/building geometry.

publish-pages.mjs deletes and replaces docs/ with a copy of web/, then adds .nojekyll. Edit web/, not docs/, or the next copy will overwrite your edits.

The current tests include checks comparing satellite assets in web/ and docs/, so refresh docs/ before running them.

Review and publish:

~~~sh
git diff --check
git status
git diff
git add web docs
git commit -m "Describe the frontend change"
git push
~~~

Stage any modified tools or tests as well. GitHub Pages publishes main → /docs. GitHub Actions runs source/data checks independently.

### After changing geographic geometry

Run npm run build first. It executes the tile generation/packaging/finalization pipeline, needs its Node/Python build dependencies, and can be substantially more expensive than a UI change. See the repository README for Python setup.

Then refresh docs/, run checks and publish. You do not need a vector rebuild just to change CSS.

### Documentation-only changes

A Markdown guide is not a runtime module and need not be included in the offline shell. Adding this guide alone does not require a new map build or offline cache version. A later publish-pages run will also copy it into docs/.

## 16. Debugging with browser DevTools

Open DevTools with F12 or Ctrl+Shift+I on desktop Chrome.

| Panel | Use it for |
| --- | --- |
| Elements | Inspect HTML, computed CSS, hidden state and overlapping controls |
| Console | JavaScript exceptions, map errors and quick read-only inspection |
| Network | Missing modules, bad paths, wrong MIME types, archive range responses |
| Application | Service-worker state, Cache Storage, manifest, local storage and OPFS where exposed |
| Performance | Slow handlers, long tasks and rendering timelines |

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

## 17. What tests prove, and what they do not

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

## 18. A small learning exercise

Trace the existing Satellite handler in app.js:

1. Find its button ID in index.html.
2. Find the click handler and list the state it changes.
3. Open satellite.js and identify source IDs versus layer IDs.
4. Find where those layers are inserted relative to road-labels.
5. Find the CSS selector for the pressed button.
6. Find the imagery files in data/satellite/.
7. Find how finalize.mjs discovers those files for offline use.
8. Follow publish-pages.mjs to see how the same files reach GitHub Pages.

That single interaction connects HTML, CSS, JavaScript events, map rendering, browser storage and deployment without requiring you to learn a frontend framework first.
