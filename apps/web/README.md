# cg-map frontend: implementation walkthrough

A code-level walkthrough of the deployed application: module responsibilities, state transitions, rendering, storage and
publication. See [architecture](../../docs/system-architecture/architecture.md) for broader system decisions and
alternatives.

## 1. Runtime boundaries

| Context                | Code                                                        | Responsibility                                                                           |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Browser main thread    | app.js, core.js, offline.js, position.js, packages/map-core | UI state, event handlers, map configuration and archive access                           |
| MapLibre internals     | vendor/maplibre-gl.js and its workers                       | Tile preparation, label placement and WebGL rendering                                    |
| Service-worker context | sw.js, offline-manifest.js                                  | Serve cached application assets and manage shell-cache lifecycle                         |
| Build process          | tools/ plus ../../data/                                     | Assemble the web artifact and generate offline manifests; data owns tile generation      |
| Static host            | GitHub Pages                                                | Serve the verified dist/web artifact directly at /cg-map/, including archive byte ranges |

The browser keeps one MapLibre instance alive. Search, selection and layer switching update existing DOM elements and
map sources/layers. There is no per-interaction backend request.

Application handlers share the browser main thread. Tile work managed by MapLibre does not make filtering or rebuilding
result lists free; avoid expensive application work during gestures.

## 2. A useful reading order

| File                                                                            | Read it to understand                                                                  |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [index.html](public/index.html)                                                 | Which controls exist and their IDs                                                     |
| [style.css](public/style.css)                                                   | Layout, positioning and visual states (device-specific @media rules)                   |
| [device-class.js](src/device-class.js)                                          | Device classes (Flip/Mobile/Desktop): media query strings and runtime detection        |
| [core.js](src/core.js)                                                          | Small data functions: search, distances, categories, Discover scale and location rules |
| [app.js](src/app.js)                                                            | Startup, directory data, controller wiring and public map events                       |
| [data-mode.js](src/data-mode.js)                                                | Server or mock data: which basemap and vehicle URLs to use                             |
| [vehicle-direction.js](src/vehicle-direction.js)                                | Direction of travel for vehicle markers (movement, or route estimate)                  |
| [config.json](public/config.json)                                               | Static hosts' data mode (`mock`); the Go server answers `server` instead               |
| [map-core/map-style.js](../../packages/map-core/src/map-style.js)               | Vector basemap sources, layers, colors and labels                                      |
| [map-core/satellite.js](../../packages/map-core/src/satellite.js)               | The bounded raster sample and its visibility switch                                    |
| [map-core/poi-icons.js](../../packages/map-core/src/poi-icons.js)               | Runtime-drawn place category icons for the map and its key                             |
| [map-core/place-visibility.js](../../packages/map-core/src/place-visibility.js) | Pure level policy: markers, zoom bands, layer specs, tap hits                          |
| [position.js](src/position.js)                                                  | Device location states, accuracy ring and position layers                              |
| [offline.js](src/offline.js)                                                    | Archive transport, verified downloads and local file reads                             |
| [sw.js](src/sw.js)                                                              | Offline file requests, shell caches and worker lifecycle                               |
| [offline-manifest.js](tools/finalize.mjs)                                       | Generated list of files for the service worker                                         |
| [data/manifest.json](tools/finalize.mjs)                                        | Generated archive URL, size, hash and offline inventory                                |
| [manifest.webmanifest](public/manifest.webmanifest)                             | Installation name, icons, start URL and scope                                          |
| ../../packages/map-core/assets/vendor/                                          | Bundled MapLibre and PMTiles libraries; do not hand-edit them                          |

Application modules load directly as browser ES modules; vendor bundles are committed separately.

## Laconic controls

The [interface feature](../../docs/ui-ux/features/interface.md) defines the implemented composition. The map fills the
viewport and starts with the dock closed. A single burger/search header keeps its geometry when the dock opens, and the
× keeps its slot in every search-bar state so the input never changes width. [interface.js](src/interface.js) owns
closed/dock/mobile-search states, the shared result panel, Empty/Open/Filled search bar states, phone card states and
swipes, focus restoration, visible-viewport geometry, and live device-class mapping. It has no dependency on data
producers or backend code.

When a foldable phone crosses the Flip breakpoint, `interface.js` maps the current view and card state into the new
layout instead of rebuilding them: Mobile search or dock becomes the Flip list, any Flip dock becomes the Mobile dock,
and card steps follow the issue #290 mapping. Camera, query, category, result highlights, selection and the open card
stay. The outgoing search controls are hidden while a card covers its mapped dock, then return when the card closes.

The burger opens the full left dock. Its bottom area holds Satellite/Transport tiles and the offline action; results
scroll above it.

**Desktop search bar** (issues #101, #246, #268): the search bar is 60 px tall (instead of 54 px) and has three states.
Empty shows only the placeholder and a floating row of category chips, with **All** first; each chip has its own shadow
and the row scrolls horizontally when it overflows. Focusing the field opens the joined Search panel in Open, with × and
a nearest-first nearby list; typing makes it Filled and filters that list. The × in Filled clears only the query and
keeps results Open. The × in Open closes the results, returns to the map, and also closes the place card. With the dock
closed, Escape follows the same sequence: the first Escape clears a query and refocuses the input, the second closes
Open results; with the dock open, Escape closes the dock. The floating row and the dock row are one element, so opening
the dock keeps its scroll position, active chip, query, and focus. The active chip (never All) and its × are two buttons
inside one green pill (40 px high, 20 px radius, 14 px left padding, 10 px right padding, 6 px gap), matching the map
chip. The × is named `Remove category <name>`; pressing it returns to All, keeps the query and the row's scroll
position. Tab reaches the menu button, the input, the clear button, the category chips and its ×. The dock remains
available for the full layer/download controls.

**Mobile search bar** (issues #102, #246, #268): on phones (≤ 720 px), the search bar is 44 px tall (smaller than the 54
px default and the 60 px desktop bar), spans the screen width minus 12 px gutters on each side, and uses smaller icons
and font. Touch targets are at least 40 px. The categories row is hidden on the main screen to save space; it remains
available inside the open dock and the search bubble, with **All** first. While both are closed, a green chip under the
header (8 px below the bar, at its left edge) stands in for the active category row: tapping its label opens the bubble
with that category, and its × returns to All. It is hidden for All, while the bubble or dock is open, and under a
Fullscreen place card, which hides the header too; a Peek or Full card leaves it visible above the card. Focusing with
the dock closed opens the bubble in Open with × and a nearest-first nearby list; the same × sequence applies: clearing a
Filled query keeps results Open, and the next × closes the bubble and any place card. With the dock open, the bottom
options hide while the keyboard is open.

**Flip search bar** (issues #103, #246, #268, #287, #288): on flip cover screens (≤ 400 px wide and ≤ 400 px tall), the
search bar shrinks to the menu (hamburger) button on the main screen — the bar width is at most the menu button width
plus 16 px. The search field and categories are hidden until the dock opens. When the dock opens, the bar spans the full
width again (as on mobile), and the search field becomes usable. The open dock's results make the bar Open, but Flip
shows no × until a query makes it Filled. That × clears only the query, leaving the dock and its results open; it never
closes the dock or card. Closing the dock belongs to the header icon button, whose three-state cycle is described below.
The category row starts with **All**, as on other devices.

With the dock closed, Flip shows standalone chips in one row 8 px right of the 44 px Icon Button, vertically centred
with it and ending 12 px from the right edge. The active category (never All) contributes a 40 px green pill with a 20
px radius; its label opens the dock's list screen and its × returns to All. A query contributes a second pill with the
same geometry; with All active it sits directly right of the Icon Button. The label shows the query in typographic
quotes, ellipsises long text, and is named `Search: <query>`; its × is named `Clear search <query>` and clears only the
query, keeping the category and refreshing the green result highlights. Both chips are hidden while the dock or search
bubble is open and while any Flip card is open, including Peek.

A query or category keeps the same in-view result marks as every device — rings for places and outlines for buildings,
addresses and streets — with the dock open and after its Close step hides the list. Closing the dock does not clear the
filter.

**Search result kinds and highlights** (issues #248, #263, #309): with **All** active (no category filter), a query
lists matching places, buildings and addresses, nearest first. An active category narrows the list to places in that
category; buildings and addresses are not searchable while a category is selected. A typed query never removes a place
from the map: the base `places` source and its all-zoom category overlay keep every place in the active category, while
the query narrows only result rows and rings. Only choosing a category other than **All** hides places outside that
category. Every matching building or address inside the current view gets a green outline. While a query or a
non-**All** category is active, every place result inside the view gets a marker drawn and a green ring at any zoom,
even below its usual POI threshold; names may collide, markers may not. With no query and **All**, the ordinary
visibility thresholds still decide which markers appear. Marks include matches past the 40-row list limit; an unchosen
result never gets the red preview. Choosing a row uses the red selection and reveals an off-screen result by the
focus-zone rule below. The marks follow the query and category on every device, not the result list's visibility: they
stay while results are open, minimised, compacted, covered by a card or dock, or closed with the query still in the bar.
Closing a card, closing search, or changing view recomputes them. The × in Filled clears only the query and keeps an
active category's results and highlights; the × in Open closes the results without resetting the category or its marks.
Only an empty query with **All** clears every mark. See
[ADR 0018](../../docs/decisions/0018-search-result-kinds-and-highlights.md).

**Full-screen dock on Mobile and Flip** (issue #104): on Mobile (≤ 720 px) and Flip (≤ 400×400 px), opening the dock
makes it cover the entire layout viewport (top 0, 100dvh) — full width, with no map visible around it. The search bar
stays at the top, full width with its gutters. The menu button closes the dock on Mobile and Desktop; on Flip the icon
button's Close state does it, as described below. The dock content ends above the keyboard because it uses the
keyboard-aware visible viewport variables (--visible-top, --visible-height). While the dock is open, the route panel is
hidden under it. On Mobile, opening a place from the list switches to the search view with the card (`placeCardOpened`
in interface.js calls `setView('search')` when the dock is open). On Flip it closes the dock and opens the card in Peek;
the Icon Button becomes × and brings the same dock list back. Desktop keeps the side dock unchanged (narrower than the
viewport). The place card and route panel keep their current behavior when the dock is closed.

**Flip icon button** (issue #247): on Flip, the menu icon button (#menu-toggle) cycles through three screens. See
[the interface requirements](../../docs/ui-ux/features/interface.md#flip-three-state-icon-button) for behavior.
Source-level details:

- `interface.js` tracks `flipDockScreen` (`'list'` | `'modes'` | `null`). When `null`, the dock is closed
  (`view === 'closed'`). The icon and label are derived from `view` + `flipDockScreen` in `syncMenuIcon()`.
- `syncDockContent()` hides only `#results` on the modes screen; `#categories` stays visible above the footer tiles.
- `syncDockContent()` is the sole owner of Flip footer visibility: the list screen always hides the footer, including
  with zero results and after keyboard/viewport events; only the modes screen shows it.
- On the modes screen, focusing the search field or typing switches to the list screen.
- An open card claims the Icon Button as ×: "Close details" in Peek and "Back to summary" in Fullscreen. Escape and the
  screen-reader close button call the same `stepBackOrCloseFlipCard()` method. `flipCardOrigin` (`'map'` or `'dock'`)
  decides where the final step returns, and a replacement selection keeps the origin captured on first open.
- The debug getter `window.kompasDebug.flipDockScreen` reports the current screen.
- Tested at 374×241, 340×250 and 340×340 viewports. The list is checked with zero, one and two results, including
  keyboard open/close events: it keeps the whole dock area and hides the footer. The CSS compact layout (style.css
  `@media` block) uses an 8 px bar inset, 30 px category chips with the active pill at 40 px (issue #268), and ~37 px
  result rows so at least 3 fit. The modes menu footer has no scroll.

Mobile search started with the dock closed uses a bubble capped at half the visible viewport, with fixed categories
above the independently scrolling list. The nearest result of an explicit search or category uses the `search-place`
layer, so it can appear below its level's zoom. Searching and choosing categories do not move the camera. Choosing a
place, building or address result moves it only when the result is outside the focus zone, the inner 75% of each map
rectangle left uncovered by the dock, search panel, keyboard, and details card (`isInFocusZone`). A phone card shortens
the uncovered map; `mapGeometry()` passes a floating Desktop card as an obstacle so `freeMapAreas()` can keep places
beside it visible. Zoom rises to at least 15 when needed. Tapping an empty spot on the map while the mobile/Flip search
bubble is open compacts results to the strip; the strip or system Back restores the bubble. On Mobile and Flip, system
Back steps through open overlays (search, dock, Flip modes, strip, and card states) toward the opening view, and UI
closes keep history aligned so Back never reopens a closed state. Reloading while overlay history is present returns to
the opening view.

A chosen place's card opens as a fixed floating sheet on Desktop (> 720 px): 1000 × 252, clamped to `min(252px, 45dvh)`,
with a 20 px bottom gap. It is centered on screen with the dock closed and centered in the map area right of the dock
when it opens; the size never changes, and the width shrinks only when that area cannot keep 20 px side margins. The
joined search panel keeps its content height and is capped 16 px above the card, so a short list does not stretch to the
card. Its frame stays put while `#card-layout` scrolls, so the plain 40 px × cannot scroll away, and closing it returns
focus to the chosen row. The grid gives identity, contacts or addresses/entrances, and hours with nearby or inside-place
sections explicit 280/270/260 px columns; the two detail stacks keep their own rows. Narrower cards step through two
columns to one. `syncLocateClearance()` sets `body[data-card-at-locate]` from the card and Locate boxes, so Locate rises
16 px above the card only when their columns overlap. The scale bar and OSM credit stay fixed in the map's bottom-left
corner: any card, panel or dock covering that corner paints over them. See
[the interface requirements](../../docs/ui-ux/features/interface.md#desktop-selected-object-card).

On phones (not Flip), the card steps through Peek, Full, and Fullscreen. A search or dock result opens in Peek under the
open results. Pulling up, or tapping the header or handle, steps up: Full shows the card with results reduced to a strip
naming the active category and query, and Fullscreen covers the screen and hides search and the map. During a phone drag
the card's top edge and height follow the finger: Full grows towards the screen edge, and Fullscreen's top sinks to
uncover the map. Release settles to the nearest step from distance, direction and velocity; a quick flick moves one
step. Full does not scroll, so long details are read in Fullscreen, whose body scrolls and whose downward pull at the
top (`scrollTop 0`) returns to Full. Swiping down steps back; from Peek it closes the card. A place picked on the map
opens in Full, and swiping down from Full closes it. Reduced motion removes the transition but keeps the same end
states. The phone card is screen-wide with 12 px gutters. The active category chip and the Locate button sit above it in
Peek and Full and hide in Fullscreen, the chip with the header; the screen-reader close button and the named card handle
remain. Choosing a result in the phone dock switches to this compact view with the query and category kept. See
[the interface requirements](../../docs/ui-ux/features/interface.md#ui-03-results-scroll-options-stay-at-the-bottom).

**Flip place card** (issues #252, #289): on Flip, every place opens a two-step card. Peek shows only the header with 12
px gutters, so the picked object remains visible above it; the 36×4 grab bar sits 4 px from the card edge in both steps
and uses the Mobile handle colour. Tapping the header or handle, or pulling up, opens Fullscreen, where details can
scroll and the Icon Button sits beside the header. The Icon Button turns into ×: in Fullscreen it returns to Peek, and
in Peek it closes the card and clears the red selection. A downward pull does the same through those button methods,
starting in Fullscreen only at `scrollTop 0` so scrolling never steps the card. Locate stays hidden through both card
steps and reappears only when the card closes. Back, Escape and the screen-reader close button share that step-back
method. It returns to the dock list when the place came from there, preserving the query, category, order and
originating row; a later map pick replaces the card without changing that origin. Back takes the same history step as
the Icon Button, and the active-category chip stays hidden under every open Flip state, including Peek. Wheel input
never changes a Flip card.

Location is a single icon in the bottom-right corner;
[UI-05](../../docs/ui-ux/features/interface.md#ui-05-honest-state-with-minimal-interruption) owns its size, offsets and
states. MapLibre's `.maplibregl-ctrl-group button` rule sizes controls to 29×29, so the app's own ID selector sets the
button size without `!important` (issue #272). The control keeps its accessible state and non-color badges. A click on
the button starts following the current GPS location: the map centres on the fix and keeps the camera there as new fixes
arrive, preserving the current zoom. Following stops on a second click, any camera move the follower did not make (user
drag, pinch, scroll, or an app-initiated move such as choosing a search result), or location failure. The follower tags
its own camera moves with `isLocationFollowMove` so the `movestart` handler can distinguish them. The button fills with
the app's pressed-toggle colour (green background, white icon) while following; `aria-pressed` and `data-following`
reflect the state. The accessible name stays constant — "Follow your location" when a fix is usable, "Locate me"
otherwise. There are no zoom buttons on the map—wheel, pinch, and keyboard zoom work instead. Route controls appear
after endpoint selection; choosing From or To closes search or the dock to show them. Source notes, live-layer states,
and offline safety remain part of the existing features. Map attribution lives in the left dock footer and also appears
as a small "OpenStreetMap" credit link below the scale bar on the map surface; the credits are read from the map's
sources at runtime so they stay in sync when layers change
([ADR 0016](../../docs/decisions/0016-map-attribution-in-the-left-dock.md)). The footer line starts with the app name
and version from `package.json`, plus the short commit recorded in the generated `data/manifest.json` at build time
(from Git locally, `GITHUB_SHA` in CI). A build with no known commit shows the version alone. The renderer keeps the
line unwrapped and drops only the commit when the full text would overflow, so Flip cover screens and other narrow
layouts keep the full licence text and links on one line.

The public app keeps orchestration in app.js. Read its named control-registration steps at the end, then follow a
handler into its rendering or data module. Routing separates provider requests, bounded transit search, and itinerary
rendering; offline downloads separate shell saving, staging, checksum verification, and activation. Selection, location,
offline controls and app-owned map layers now have explicit modules; each application continues to build independently.

## 3. What happens when the page opens

1. The browser parses index.html and creates its DOM.
2. It loads CSS and the bundled MapLibre/PMTiles scripts.
3. It evaluates app.js as an ES module, resolving its imports.
4. Module-level code creates category buttons and registers UI handlers.
5. start() begins asynchronous initialization.
6. It rejects file:/content: opening and checks that vendor libraries loaded.
7. It fetches data/manifest.json, data/places.geojson, and data/place-visibility.json.
8. It validates each place's level and builds placesById and the marker keys from the stable place ID.
9. It registers the service worker where supported in a secure context.
10. ArchiveSource.init() checks for an activated local archive in OPFS.
11. It registers the PMTiles protocol with MapLibre.
12. It creates one MapLibre Map using mapStyle(), initially over Podgorica.
13. It adds a ResizeObserver. map-core also adds a NavigationControl, but the zoom buttons are hidden via CSS.
14. When MapLibre emits load, it installs satellite sources, place layers, the selected-place overlay and city labels.
15. It enables the satellite button, hides the loading message and builds the result list.

MapLibre's load event is not a guarantee that every later camera position, hidden image or future tile is already
loaded. The renderer continues requesting data as needed.

The top-level start().catch(...) handler displays startup errors. Later map errors use a separate map event handler.

## 4. Where application state lives

app.js coordinates map, directory and startup state plus route endpoints. Three workflow controllers keep their
transient state with the behavior that changes it:

| Owner                                        | State and responsibility                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `mapState`                                   | The single MapLibre map, its interface/controllers, readiness, optional layers and camera-exploration policy |
| `directoryState`                             | Loaded places, visibility rules, stable marker keys, building addresses and the active search                |
| `startupState`                               | Host data mode, endpoint URLs, service-worker registration and offline adapters                              |
| `routeEndpoints`                             | In-memory From/To points passed to the route planner                                                         |
| [PlaceSelection](src/place-selection.js)     | The selected listing or point, leading preview, deferred camera framing and return-focus target              |
| [LocationControls](src/location-controls.js) | The in-memory fix, its distance origin, location following, explicit requests and first-fix recentering      |
| [core.js](src/core.js)                       | Pure utilities: search, distance, scale, and position helpers                                                |
| [OfflineControls](src/offline-controls.js)   | Download/cancel/remove actions, progress, storage notes and the connection badge                             |

Controllers read the map and directory through getters because those inputs finish loading independently after the
controls are bound. Selection and location keep their transient state private; app.js wires their effects together.

[place-details.js](src/place-details.js) renders details and result rows without owning the selection. It preserves the
focused row when a camera move rebuilds the list and patches a late building-address row without rebuilding the card.
[map-selection.js](src/map-selection.js) chooses the most specific hit and calls the matching selection action, opening
the first identity of the topmost rendered listing marker directly. [public-map-layers.js](src/public-map-layers.js)
installs app-owned overlays; shared rendering remains in map-core. [status-messages.js](src/status-messages.js) keeps
transport/location wording pure. Map gestures are MapLibre's own, unchanged
([ADR 0015](../../docs/decisions/0015-maplibre-gestures-unchanged.md)).

Nearest results from `selectNearestPlaces()` carry `feature` and `distanceKilometres`. Search normalization is
`normalizeSearchText()`, its predicate is `matchesPlaceSearch()`, and GeoJSON construction is `featureCollection()`.
Scale helpers consistently use metres; position limits spell out milliseconds and metres.

There is no automatic reconciliation: handlers change state, update the affected DOM/map views, and restore usable
focus. Shared data formats, visible text and storage keys are preserved. The reduced-motion query is shared through
`isReducedMotionPreferred()` in dom.js: startup captures its value for selection/location moves, while route framing
reads it for each move, preserving both existing policies.

## 5. Search: follow one event end to end

Suppose the user types "museum".

1. The search input emits an input event.
2. Its handler cancels the previous timer.
3. It schedules applyPlaceSearch() after 120 ms without another input event.
4. applyPlaceSearch() uses placesForMapLayer() to keep every place in the current category.
5. It calls matchesPlaceSearch() on those places; matchesPlaceSearch() normalizes text: lower case, diacritic folding
   and supported Cyrillic transliteration.
6. Search checks name, name:en, kind and addr:street.
7. It assigns the query-and-category result array to directoryState.filteredPlaces.
8. If the map is ready, it calls setData() on the category-only places GeoJSON source and on the explicit-filter result
   marker source.
9. It closes the current place card if that place no longer matches.
10. collectSearchResults() collects matching places and labelled buildings once, then rankSearchCandidates() sorts those
    candidates by approximate distance from the usable GPS fix when one exists, otherwise from the map center, and
    renderSearchResults() creates up to 40 result buttons. In-view highlights come from the full candidate set, not the
    40 rows. The camera does not move, and map moves do not reorder the list while any card is open.

This is substring search over an in-memory dataset. It is not fuzzy search, a full-text index or a server request.

Distance is an approximation in kilometres from a fresh or approximate GPS fix, not a route length. Without such a fix,
rows keep center ordering but show no distance: the camera is never presented as the person's location. Changed fixes
re-rank after a 200 ms throttle; a card freezes the row order until it closes.

Selecting a category updates category and calls the same applyPlaceSearch() path.

Panning re-ranks candidates on moveend and renders only when no card is open. Without a usable fix that changes nearest
ordering; with one, the fix keeps the order while the list and highlights refresh. Panning does not change the
text/category filters or restrict the search dataset to the visible rectangle.

## 6. Two rendering systems share the screen

The browser displays ordinary HTML controls. MapLibre draws the geographic scene into a canvas.

A result button is a DOM element. A place circle is a feature drawn by a MapLibre layer; it is not an individual HTML
button.

This distinction keeps thousands of map features out of the DOM.

### Sources contain data; layers describe drawing

Sources hold geometry or imagery. Layers apply rendering rules to a source; changing a layer does not replace its data.

[Stable POI visibility](../../docs/ui-ux/features/poi-visibility.md) decides which markers exist. The `places` source
holds marker features built by map-core/place-visibility.js for every place in the active category; changing only the
query leaves this source intact. An explicit query or category also fills `search-result-markers` with the all-zoom,
app-owned markers: query result locations under **All**, or every place in the active category. Query results alone
receive rings:

| Layer                | Purpose                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| place-icons-`<band>` | Icon only, one layer per zoom band, ignoring all collisions. Earlier levels draw above later ones               |
| place-names-`<band>` | Name only, collision-aware, below road names and house numbers. A missing name never affects its icon           |
| search-place         | The selected listing or leading explicit result, from `requested-place`, shown only below its marker's zoom     |
| search-result-places | Every active-category place, or query result locations under **All**, from `search-result-markers`, at any zoom |
| place-highlight      | Invisible ring that becomes the selection highlight through feature state                                       |

A band is a zoom range: `4-open` starts at level 4's zoom and never ends. Layer `minzoom`/`maxzoom` are compared with
the continuous zoom, unlike a filter's `['zoom']`, so thresholds are exact at fractional zooms and need no work during
gestures. Closed bands such as `2-5` exist only for co-located listings of different levels, whose shared marker gains
members at a later threshold. Marker and feature-state identity is the stable place ID, or a `shared:` key built from
all co-located IDs. Never use array positions.

map-core/poi-icons.js draws the category icons at runtime, so no sprite file is needed. position.js owns device
location: its state machine, accuracy ring and layers; coordinates never leave memory.

Selection fill/outline layers filter the original basemap source layer by feature ID, preserving full polygons across
tiles and zoom levels. Area selection adds no extra point marker.

The basemap source is vector tiles. Its source-layer fields refer to named datasets inside each tile, such as roads and
buildings. A MapLibre layer ID and an MVT source-layer name are different identifiers.

### Camera movement

MapLibre owns pan/zoom gestures, projection, tile selection and rendering. The app asks it to move using easeTo() or
fitBounds().

Do not destroy and recreate map when switching a category, showing details or changing layer visibility. That would
throw away camera state and rendering resources.

### Map style expressions

In map-core/map-style.js, arrays such as interpolate and match are MapLibre expression syntax. They describe
zoom-dependent widths, colors and filters; they are not JavaScript function calls.

CSS does not set vector-road colors. Change map-core/map-style.js for cartography and style.css for HTML controls.

## 7. Selecting and closing a place

Map clicks use queryRenderedFeatures() on the place icon, place name, and search-place layers. Places are not clustered;
one below its level's zoom is reached through the result list.

- A listing hit passes the first active ID of the first rendered marker hit to PlaceSelection.showPlace(); there is no
  chooser for co-located or overlapping listings.
- A background click closes the card.
- A result-list button calls PlaceSelection.showPlace() directly.

PlaceSelection.showPlace():

1. Looks up the feature in placesById.
2. Stores selected and the originating control, when supplied.
3. Fills card text and safe links.
4. Shows the existing card element.
5. Uses the building rendered under the place as the address source and keeps that address for the selection. A place
   pick still shows only its marker ring; the footprint highlight belongs to a separate building pick.
6. Moves the camera only if the place is outside the focus zone, or zooms in if the map is below street level.
7. Focuses the close button, which on phones is available only to screen readers.

PlaceSelection.close() clears the feature, hides the card, clears the selection filters and restores focus when
possible. Escape also closes the mobile results panel.

This is all local interaction with already loaded data. No detail endpoint is called.

## 8. How the satellite switch works

map-core/satellite.js installs two sources and two raster layers, initially hidden:

1. satellite-preview: one georeferenced WebP mosaic of the whole sample.
2. satellite-tiles: the original 16 XYZ tiles at native zoom 17.

The preview remains beneath the detailed tiles. It covers the footprint at lower zooms and while native tiles load.

Both layers are inserted before road-labels. Existing road labels and the place layers remain above the photographs.
Outside the small image footprint the vector basemap remains visible.

Clicking Satellite:

- Toggles satelliteVisible.
- Changes layer visibility rather than replacing the map/style.
- Updates the button text and aria-pressed state.
- Shows the coverage/source note.
- Centers on the sample at zoom 17.5 when enabling it.

Activating Satellite again hides the imagery; its short label stays Satellite and aria-pressed reports the state. It
does not reset the camera.

The sample covers roughly 900 × 900 meters, not all Podgorica. Further zoom magnifies the existing photos. MapLibre can
draw raster imagery and vector geometry together; the photographs do not make vector buildings blurry.

The app requests bundled local files, not eMapa at runtime. Source URLs and licensing uncertainty are recorded
separately in data/satellite/.

## 9. Coordinate order: an easy mistake

GeoJSON and the MapLibre calls used here use:

```js
[longitude, latitude]
[19.26, 42.437] // Podgorica
```

This is the reverse of many human-readable GPS displays. PlaceSelection.showPlace() reverses a copy only to print
latitude/longitude in the card.

Bounds are:

```js
[west, south, east, north]
```

MapLibre image corners are ordered top-left, top-right, bottom-right, bottom-left.

Do not copy Leaflet's usual latitude/longitude argument order into these MapLibre/GeoJSON structures.

## 10. Offline is split across several browser stores

| Store         | Contents                                                   | Owner                            |
| ------------- | ---------------------------------------------------------- | -------------------------------- |
| Cache Storage | HTML, scripts, CSS, places, fonts, icons, satellite assets | Service worker and download code |
| OPFS          | Complete PMTiles archive                                   | ArchiveSource                    |
| localStorage  | Small active-archive filename marker                       | ArchiveSource                    |
| Memory        | Current state, tile cache, optional whole-archive Blob     | App / MapLibre / archive reader  |

A service worker is a separate browser-managed JavaScript context. It cannot edit the page DOM. Here it intercepts
eligible same-origin file requests and serves cached responses.

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

Cancellation uses AbortController. The new archive is not activated before verification. This does not provide full
atomic rollback across every shell/cache/release component.

### Why old UI can survive a deployment

The service worker serves cached assets first. [app-updates.js](src/app-updates.js) checks for a new worker once on page
load or reload, without background polling or focus/connectivity checks. A replacement shell bypasses the browser HTTP
cache and activates only after every required asset is cached.

A successful update automatically reloads open app tabs at their existing URLs. The worker initiates navigation without
awaiting it during activation, avoiding a lifecycle deadlock and also refreshing tabs running older app code. First
installation does not reload. Failed replacements keep the working offline shell; verified archives stay in OPFS. A
reload resets session selections/routes. See [release updates](../../docs/runbooks/release.md#automatic-app-updates).
Browser data does not need to be cleared.

The current "Exploring offline" / READY state mainly reflects the activated local vector archive. It is not proof that
the device has no network, every cache is intact, or storage can never be evicted.

HTTPS or localhost is required for the relevant offline APIs. Opening index.html directly is unsupported.

## 11. Resizing and mobile behavior

The shared core's ResizeObserver watches the map container. The callback cancels an earlier scheduled resize and
schedules map.resize() through requestAnimationFrame(). Removing the map cancels that frame and disconnects the observer
and the shared house-number scale listeners.

This lets MapLibre update its canvas when the real container dimensions change, for example during rotation. It does not
rebuild map sources or tiles.

MapInterface switches the shared result panel between the full dock, the desktop search panel, and the mobile search
bubble. The category navigation stays outside the scrolling list and begins with the All chip. There is no count/reset
row; clicking an active category or its × returns to All without clearing the query. When the row is off screen on
Mobile, interface.js shows one active category chip under the header from the same directoryState value. On Flip it
shows a top-row pair: the same category chip plus a query chip from the search field, governed by the pure
`isQueryChipVisible` rule in [interface.js](src/interface.js). Both use the same `openChipTarget()` path, so tapping a
label opens the control that owns its row. Both hide while a dock or bubble covers the map; Flip chips also hide while
any Flip card is open, whereas the Mobile chip stays above a Peek or Full card and hides only in Fullscreen. The bubble
extends to the visible viewport's midpoint. visualViewport resize/scroll events update the bubble cap and hide the phone
dock's options when a keyboard reduces the visible area; the camera stays still until the keyboard closes. On phones
(not Flip), selecting a search or dock result keeps search open and shows the card in Peek, stepping up through a
continuous top-edge drag to Full and Fullscreen; a map pick opens the card in Full. The selected feature stays in the
visible map area and the burger/search header is never replaced or moved.

When changing mobile CSS, test rotation, keyboard opening, long place names, scrolling and closing panels. A desktop
window made narrow does not reproduce an Android GPU or browser lifecycle.

### Device classes

The app distinguishes three viewport categories. The single definition lives in
[src/device-class.js](src/device-class.js) as exported media query strings; the CSS `@media` rules in
[style.css](public/style.css) must use the same conditions. At startup and on each matching media-query or resize event,
`app.js` and `interface.js` derive `body[data-device]`, the cached `interface.deviceClass`, the dock screen, card
presentation and history steps from that one class. Runtime code reads the shared `deviceClass(matchMedia)` helper and
its live `isFlip`, `isMobilePhone`, `isPhoneLayout` and `isDesktop` getters; no layout reads a media query directly or
keeps a stale class after a fold.

| Class   | Rule                                     | Examples                                 |
| ------- | ---------------------------------------- | ---------------------------------------- |
| Flip    | `width ≤ 400px` **and** `height ≤ 400px` | Galaxy Z Flip cover screen (~340–380 px) |
| Mobile  | `width ≤ 720px` (excluding Flip)         | Phone portrait (412×840), small tablet   |
| Desktop | Everything else                          | Laptop (1280×800), desktop (1920×1080)   |

The 400 px limit on both axes separates Flip from phones: a phone in portrait (e.g. 412×840) exceeds 400 px in height,
and a phone in landscape (e.g. 840×412) exceeds 400 px in width. The thresholds are chosen so that a future Flip variant
with a slightly larger cover screen still matches, without catching a phone in any orientation.

Folding between 412×840 and 340×250 is a live class change covered by [fold.spec.mjs](tests/e2e/fold.spec.mjs).
`viewForDeviceClass()` maps Mobile search/dock to the Flip list and Flip panels to their Mobile owners, while an open
card keeps the Flip screen to itself; `cardStateForDeviceClass()` maps Peek/Full/Fullscreen as the interface rule
states. Both are pure helpers with unit tests in [interface.test.mjs](tests/interface.test.mjs).
`applyViewForDeviceClass()` and `applyCardForDeviceClass()` apply that mapping and keep the Flip card's dock origin, and
`onViewportResize()` also handles a resize that arrives before the media-query listener. `app.js` passes the
device-change reason to `PlaceSelection.viewportChanged()`, which holds reframing until an explicit selection;
`window.kompasDebug.deviceClass` and `flipDockScreen` expose the cached values for browser checks. Browser tests can run
a scenario at a Flip viewport using `withFlipViewport()` from [tests/e2e/helpers.mjs](tests/e2e/helpers.mjs) without
adding a separate Playwright project; pass a viewport object for a real cover screen or use the exported
`FLIP_VIEWPORTS` list. The default remains 340×340 for earlier scenarios.

## 12. How to make common changes

| Goal                        | Start here                                                    | Follow-up                                          |
| --------------------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| Change button wording       | index.html or app.js, depending on who creates it             | Regenerate offline manifests                       |
| Change sidebar/card spacing | style.css                                                     | Check desktop and mobile                           |
| Change road/building colors | map-core/map-style.js                                         | No geometry rebuild needed                         |
| Change marker colors        | map-core/palette.js                                           | Check list icons and map                           |
| Change search fields/rules  | matchesPlaceSearch() in core.js                               | Add a meaningful search regression test            |
| Change result limit         | selectNearestPlaces() in core.js                              | Consider list cost/usability                       |
| Change initial center/zoom  | createMap options in app.js                                   | Test cold startup                                  |
| Add a card field            | renderPlaceDetails() in place-details.js and place properties | Use textContent and safe links                     |
| Add/edit a place            | ../../data/sources/places.geojson                             | Reapply levels (data runbook); review count tests  |
| Change when a place appears | ../../data/sources/place-visibility-policy.json               | Follow the data runbook's level steps              |
| Change building footprint   | ../../data/sources/buildings.geojson                          | Rebuild vector tiles, then publish                 |
| Expand satellite coverage   | map-core/satellite.js, tiles, preview, provenance             | Keep bounds, corners and tile inventory consistent |
| Change offline assets       | public/, src/, or map-core assets                             | Rebuild; both manifests are generated              |

A new module under src/ needs no per-file list: build.mjs copies it at its own path and finalize.mjs derives the offline
shell from the built artifact. Modules that existed on main keep their reviewed imports transitively; every module with
no local imports on main (for example core.js and dom.js) may not gain any. Moving a reviewed module fails until its
rule moves into #456's per-folder rules. New modules may import any runtime module inside src/ and the published
map-core entry. Colocated tests and support files stay out. config.json, generated manifests and archive/range responses
are never shell-cached.

## 13. Local development and publication

The source layout separates src/ runtime modules, public/ static assets, tools/ assembly, and tests/. The build keeps
runtime paths under src/, so a nested module keeps its path in dist/web; index.html still loads ./app.js.

Run commands from repository root:

```sh
make setup
make -C apps/web dev
make check
make -C apps/web e2e
```

make -C apps/web dev builds the app and runs the Go backend on dist/web at localhost:8080 (server mode); make -C
apps/web dev-mock serves it statically (mock mode). Rebuild after edits; there is no hot reload. The build consumes
reviewed data/artifacts, data/sources/places.geojson, and data/imagery without regenerating geography. Offline manifests
exist only in dist/web.

Geometry changes require make -C data build-data with its optional Python dependencies. UI changes need only a web
build. GitHub Actions validates dist/web on a PR and publishes it from main. Do not commit built output. See
[release](../../docs/runbooks/release.md) and [data](../../docs/runbooks/data.md).

### Focused browser checks

Follow the [web testing workflow and measured timings](AGENTS.md#testing). Start with `make verify PKG=apps/web` for
frontend lint, boundaries, build, Node tests, and offline manifests; it does not run Playwright. During iteration,
choose browser cases that exercise the changed behavior instead of running the entire suite after every edit.

Run these commands from apps/web. The local Playwright configuration selects a per-worktree port automatically; E2E_PORT
overrides it when needed:

```sh
# One transport scenario on mobile
npm run test:e2e -- --project=pages-mobile --grep 'transport toggles'

# Routing scenarios on desktop
npm run test:e2e -- --project=root-desktop --grep 'route modes|route errors'

# Service-worker update scenarios on both deployment projects
npm run test:e2e -- tests/e2e/updates.spec.mjs

# All mobile cases
npm run test:e2e -- --project=pages-mobile

# List the selected cases without executing them
npm run test:e2e -- --project=pages-mobile --grep 'transport toggles' --list

# Immediately after a failed run, rerun its failed cases
npm run test:e2e -- --last-failed

# The component Make target also accepts filters
make e2e E2E_ARGS='--project=pages-mobile --grep="transport toggles"'

# List device-scoped cases without executing them
npm run test:e2e -- --project=pages-mobile --grep '@mobile-only' --list
```

`pages-mobile` always runs only `@phone` tests, including in nightly CI. A test tagged `@mobile-only` or `@phone-only`
runs only there and also carries `@phone`. `@desktop` runs only in `root-desktop`. Prefer a tag to a device loop inside
a spec, which repeats the case in both projects. See
[phone layout tests](../../docs/verification/testing.md#phone-layout-tests).

`--grep` is a regular expression over test titles; combine it with a file and `--project` to narrow the selection. Both
projects run when `--project` is omitted. Standalone `npm test` and `npm run test:e2e` build the artifact first from the
pinned data package. The built-artifact variants, `npm run test:built` and `npm run test:e2e:built -- <filters>`, reuse
whatever `dist/web` holds and never rebuild, including with `--list`. Build that artifact from the pin first, otherwise
they test a stale or development-data build. Browser traces/screenshots and the last-run record are in
apps/web/test-results (not the repository root).

Root npm aliases forward to these workspace scripts, including browser arguments. Root Make aliases forward to the web
Makefile; `make -C apps/web e2e` builds first and `make -C apps/web e2e-built` reuses the artifact from `make check` in
CI. Root package.json and package-lock.json remain the shared workspace manifest and lockfile. Build, lint, offline
checks, browser setup, browser journeys, and static preview are owned here; repository checks aggregate component
commands. Cross-component contract/artifact tests remain in tests/integration.

GitHub runs the full acceptance suite as app-owned shards for web/UI, offline, and release behavior changes. A local
full run is optional for iterating; targeted results do not establish that the full suite passed. Documentation-only
changes do not need browser tests.

CI splits the browser suite into shards counted in `browser-jobs.json`; see
[browser test shards](../../docs/verification/testing.md#browser-test-shards). Shared helpers are in
tests/e2e/helpers.mjs.

Card gesture specs size step swipes from the measured card box and viewport edge, so distance alone crosses the settle
threshold on a slow runner. Flick specs dispatch DOM touches with explicit `timeStamp` values because the app reads
`event.timeStamp`; CDP timestamps do not control that calculation. Release-state assertions capture geometry in the
release task, and only no-op pulls keep a fixed short distance.

The default worker count is one, and CI uses two. Raising `E2E_WORKERS` further is a performance experiment: benchmark
elapsed time and verify isolation and stability before adopting it. Smaller selections are the default way to shorten
the development feedback loop.

## 14. Debugging with browser DevTools

The app exposes window.kompasDebug for inspection:

```js
window.kompasDebug.placeCount
window.kompasDebug.selected
window.kompasDebug.deviceClass
window.kompasDebug.flipDockScreen
window.kompasDebug.satellite
window.kompasDebug.offline
window.kompasDebug.map.getCenter()
window.kompasDebug.map.getZoom()
window.kompasDebug.map.getStyle().layers.map(layer => layer.id)
```

The geographic map handle is available only after successful map construction. Debug inspection is not a replacement for
testing what users see.

Common symptoms:

| Symptom                                  | Check first                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Old UI after deployment                  | Reload while online; inspect worker update/install failures                           |
| Satellite button remains disabled        | Map startup failed or load did not finish                                             |
| WebGL initialization error               | Browser/device graphics support; this is before layer interaction                     |
| Satellite disappears outside a rectangle | Expected sample coverage                                                              |
| Photos blur at very high zoom            | Native raster resolution                                                              |
| New script fails only offline            | Missing shell entry or stale manifests                                                |
| Fonts/labels missing                     | Glyph URL, requested character blocks and network responses                           |
| Blank map after layout change            | Container dimensions and map.resize()                                                 |
| Place exists but is absent from list     | Text/category filter or nearest-40 limit                                              |
| Place is listed but has no map icon      | Its visibilityLevel's zoom has not been reached without an explicit query or category |
| Download fails after changing files      | Stale manifest, incomplete assets, quota or integrity mismatch                        |

Observe the actual error before changing rendering code. A 404, stale cached script, disabled WebGL and malformed
geometry need different fixes.

## 15. What tests prove, and what they do not

Node tests cover archive decoding/style validity, search, link safety, download transactions, service-worker responses,
HTTP transport fallback and satellite configuration/assets. Logic that needs no rendered engine—POI level bands, search
filters and highlight state, and route/transport errors—lives in tests/*.test.mjs; browser specs keep the journeys that
need MapLibre, layout or real input. There are also Python server tests and an optional browser script in
../tests/browser-check.mjs.

Unit tests can prove a generated style is valid or original tile hashes match. They cannot prove a phone's pinch zoom is
smooth, a GPU draws the expected pixels, or an offline browser retains files indefinitely.

For a UI change, manually check:

- Initial page load with a fresh session.
- Search, category changes, place selection and closing.
- Satellite on/off, panning beyond sample coverage and zooming.
- Mobile-sized layout and real-device rotation.
- Offline download followed by reopening without a connection.
- An existing installation receiving a new release.

The latest cloud-browser inspection could not render because that browser disables WebGL. Do not interpret it as a
successful visual test of the satellite layer.

## Data modes

At startup app.js reads `config.json` from its host. The Go server (services/backend) answers `{"api":"server"}`: the
basemap comes from its TileJSON (`api/v1/layers`) and buses from `api/v1/transport/vehicles`. Static hosts (GitHub
Pages, `make -C apps/web dev-mock`, e2e) serve the artifact's `{"api":"mock"}`: the current static data, i.e. the
release archive read directly and the hosted transit relay. Add `?api=server` or `?api=mock` to the URL to switch by
hand. A verified offline download is always read locally, in either mode. A missing `config.json` or an offline start
means mock. A 5xx answer also means mock, with a visible notice. Other HTTP errors and invalid content stop startup with
a visible error. In server mode, finishing or removing an offline download during the session switches the basemap
between the API and the local archive. config.json is not in the offline shell because it describes the host.

## Optional transport

[transport.js](src/transport.js) installs static stop circles/names and live vehicle markers/route labels. Each marker
is a teardrop pointing in the bus's direction of travel ([vehicle-direction.js](src/vehicle-direction.js)): solid once
movement is known, outlined while estimated from the route, a plain disc when neither is available. Transport visibility
controls both, while only vehicle positions are cleared during offline/hidden/error states. Stop selection in app.js
uses text nodes in a MapLibre popup. The build copies the reviewed stop snapshot into the offline shell; live vehicle
responses are never cached there. See [transport behavior](../../docs/ui-ux/features/transport.md).

## Point selection

[point-selection.js](src/point-selection.js) describes clicked features and installs the A/B endpoint layers. app.js
presents the shared details card and stores From/To session state. [object-selection.js](src/object-selection.js)
highlights source polygons with a contour and translucent fill, or lines with a stroke. A picked place or stop keeps
only its existing marker ring; a separate building pick owns the footprint highlight. Bare coordinates use a small
circle. No extra pin is added. See [point selection](../../docs/ui-ux/features/point-selection.md) for hit priority,
available metadata, and offline behavior.

## Routes

[routing.js](src/routing.js) handles car/foot requests, [transit-routing.js](src/transit-routing.js) searches local bus
patterns, and [route-planner.js](src/route-planner.js) owns mode controls, cancellation, line layers, and itinerary
rendering. See [routing](../../docs/ui-ux/features/routing.md) before changing providers, transit assumptions, or
offline behavior.

## Building addresses

map-core/map-style.js loads the reviewed building-labels.geojson as a separate local source and renders interior house
numbers from the 100 m scale. point-selection.js joins polygon IDs to the reviewed address index, so building details
remain consistent even when number labels are hidden. The web build includes this source in the offline shell; the
basemap archive is unchanged. See [building numbers](../../docs/map-data/building-numbers.md).

## Shared map runtime and additional apps

The public app consumes [packages/map-core](../../packages/map-core/README.md) for map lifecycle and shared rendering.
Cartography, satellite, POI icons and visibility policy live only there. The core has no public UI, offline download
state or editorial commands. Asset assembly includes its modules in the public offline manifest. The separately built
[concept app](../core-demo/README.md) and [source viewer](../editor/README.md) use the same core; their artifacts and
source bundle never enter dist/web.
