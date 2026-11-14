# Discover: the default map experience

Status: target product requirements, agreed direction on 1 November 2026, with the
[laconic interface presentation](../features/interface.md) revised on 3 November; **not a description of completed
implementation**. The product journey is **Discover → Understand → Plan → Travel**. This document specifies Discover:
what a person can learn by looking at the map before searching, selecting an object, choosing a mode, or enabling a
layer.

This target extends the maintained outcomes in [US-01–03 and US-13](user-stories.md): orient on the map, find or browse
places, and understand current-position state. It raises geographic completeness and first-view expectations beyond
current implementation; see the [interface feature](../features/interface.md) for control presentation.

## Purpose and user success

**As someone opening the map, I want to see my surroundings and position immediately, so I can discover where I am, what
is around me, and which ways lead through the area.**

The first useful view must answer five questions together:

| Requirement             | Question the map answers without an object interaction                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| D-02 Movement network   | Which roads, named streets and bridges, pavements, paths, and other travel corridors exist, and how do they relate? |
| D-03 Buildings          | What are the building shapes, their recorded addresses, and their types?                                            |
| D-04 Terrain and levels | Where does the ground rise or fall by 5 m or more, and which roads/bridges are above or below their surroundings?   |
| D-05 Points of interest | Which businesses, landmarks, attractions, and useful places matter at this scale?                                   |
| D-06 Current position   | Where am I, how uncertain is that position, or why is it unavailable?                                               |

Reading this scene is Discover. Opening a feature to inspect its details is [Understand](understand.md). Choosing
endpoints and comparing travel options is Plan. Acting on the chosen plan is [Travel](travel.md), with live
route-following as a separate target. The existing [user stories](user-stories.md) remain the baseline of implemented
capabilities.

**MUST** means required to satisfy this target. **SHOULD** means the recommended design, with a documented reason
required for a different choice. Numerical values explicitly marked **proposed** are initial tuning candidates, not
research findings or completed performance measurements.

## D-01 First useful view

1. The five information classes MUST be enabled in the default map. They MUST NOT require search, selection, a layer
   switch, a download action, a route request, or a tutorial to become visible. Show features that actually exist in the
   viewport; do not manufacture a bridge, business, address, or position to fill a category.
2. The initial camera MUST use a useful local street scale, showing both pedestrian connections and building/address
   context. A proposed starting point is approximately **1 ground metre per CSS pixel** at the view center. The exact
   camera setting is tested on real phones; country context is available through panning and zooming, rather than being
   the first view that hides all local detail.
3. With permission and a sufficiently fresh location in supported coverage, the initial camera SHOULD center on that
   location. While acquiring location, show the default covered area with an explicit icon state and accessible status.
   Without a usable fix, keep that area usable and identify it as a fallback in the accessible state, never as the
   user's position. If the fix is outside coverage, distinguish that state and retain useful covered-map context rather
   than implying that an empty map means no roads or buildings exist. Follow D-06 for recovery after a location action.
4. Start rendering available base information without waiting for geolocation, live transport, or external routing.
   Loading an unrelated optional service MUST NOT block Discover. A failed required layer MUST have a visible, specific
   failure/coverage state; a partly drawn map is not full Discover readiness.
5. The map MUST remain the principal initial content on a phone. Controls and attribution (in the left dock footer, per
   [ADR 0016](../../decisions/0016-map-attribution-in-the-left-dock.md)) MUST leave a contiguous area where the person
   can read nearby streets, buildings, terrain, POIs, and their position together. Follow the
   [interface target](../features/interface.md#ui-01-opening-view): no initially open dock, place card, route panel, map
   key, or persistent location text banner. Make geographic encodings interpretable through recognizable symbols,
   redundant cues, and appropriate map labels; a persistent legend must not be needed to read the scene. This
   presentation supersedes the earlier automatically visible key requirement.
6. All required geographic content MUST remain available after a verified offline download. Device location remains
   subject to permission and the device's ability to obtain a fix; offline map readiness does not guarantee positioning.
   Preserve the [existing offline invariants](../../AGENTS.md#invariants).

“Immediately” means **automatically in the first useful rendered view**, with honest loading/permission states while
information is acquired. It does not mean a synchronous GPS fix or downloading every scale before drawing. A proposed
performance experiment is p95 first useful view within 5 s online and 2 s when already saved; device, connection,
cold/warm cache, coverage area, and readiness instrumentation must be fixed before those become release budgets. No such
timings have been measured for this target.

## Scale and visual hierarchy

Cartographic generalisation changes representation as space becomes limited. This is established mapping practice;
Ordnance Survey describes selecting, simplifying, merging, and displacing features to retain legibility. The following
bands are **our proposed product policy**, rather than universal mapping standards.
[Ordnance Survey: scale and generalisation](https://www.ordnancesurvey.co.uk/blog/what-is-cartography).

Measure scale as ground metres per **CSS pixel** near the viewport center. Zoom numbers alone are insufficient
acceptance criteria because latitude, camera configuration, and rendering conventions affect the ground area displayed.
Retain a metric scale bar. Test equivalent ground scales across desktop/phone and changing latitude.

| Proposed band    | Ground metres / CSS pixel | Movement and buildings                                                                                                 | Terrain                                                                           | Default POIs                                                                                                                                     |
| ---------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Country          | ≥200                      | National corridors and settlements; no individual ordinary building/address detail.                                    | Major relief and landforms; generalized elevation context.                        | Only individually ranked national landmarks/attractions and major travel gateways. **No local cafes, shops, or their aggregate count clusters.** |
| Region           | 20–<200                   | Inter-settlement connections, regional roads, significant crossings.                                                   | Ridges, valleys, major slopes; generalized contours where readable.               | Regional landmarks and hubs, selected by importance and available space.                                                                         |
| City / district  | 4–<20                     | Connected street structure, major pedestrian links, building masses where legible.                                     | Local landform context and meaningful slope changes.                              | District landmarks and essential anchors; ordinary businesses normally suppressed.                                                               |
| Street — default | 0.5–<4                    | Streets, named bridges, sidewalks, paths, steps, building footprints/types, recorded house numbers and street context. | 5 m relief requirement; contours plus landform/structure cues.                    | Relevant local businesses and attractions with fixed-level icons and names when space permits.                                                   |
| Close detail     | <0.5                      | Refine addresses, entrances, small links, and mapped access distinctions without inventing positional precision.       | Retain small slopes, scarps, steps, and grade separation with supported accuracy. | More local detail as space permits; readability still limits density.                                                                            |

Every class is available by default **at its appropriate scale**. Automatic scale selection is not a hidden layer
toggle. Country-scale suppression of a cafe does not remove it from the directory or prevent later discovery through
search. Street-level information must already be present on opening at the local default scale.

The visual hierarchy MUST keep roads/paths, addresses, important terrain discontinuities, and current position readable
before spending remaining space on ordinary POIs. A location's uncertainty area must not blanket the map with opaque
fill. Reduce decorative detail and low-priority business symbols before obscuring the network or turning terrain into a
solid texture.

## D-02 Roads and every way to travel

The movement network MUST represent mapped travel corridors as a coherent network, rather than only car roads. It
includes motor roads and streets, service/living streets, pedestrian streets and squares, pavements/sidewalks,
footpaths, cycleways, tracks, stairs, crossings, bridges, tunnels, and relevant rail/ferry connections where present in
the supported geography. Rail/ferry lines show context and connections; they do not imply a current passenger service or
timetable.

| Property                | Required presentation at a useful local scale                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Geometry and continuity | Lines and areas remain connected where the source establishes a connection. Generalisation must not create false crossings, remove the only foot connection, or merge distinct parallel corridors.                                                                                          |
| Mode and kind           | Carriageway, pedestrian way, cycleway, stairs, rail, ferry, and restricted/private ways have distinguishable line patterns, widths, or symbols. One generic minor-road stroke is insufficient.                                                                                              |
| Names                   | Street names and recorded bridge names are readable on the map, without selection. Preserve a bridge's own name separately from the name of the road it carries; avoid duplicating a label at every source segment. Unknown names stay unknown.                                             |
| Sidewalks               | Support both separately mapped sidewalks and sidewalk information attached to the street. Indicate a tagged sidewalk without claiming an independently surveyed centerline; do not draw it twice when it is already a separate way.                                                         |
| Crossings and level     | Visually distinguish a junction from a road crossing overhead/underneath. Show mapped entrances/exits, stairs or ramps between levels; intersecting screen lines alone do not establish connectivity.                                                                                       |
| Travel constraints      | Display known one-way direction, barriers, access/mode restrictions, and construction/closure status from the published snapshot when relevant at street scale. A mapped corridor is not a guarantee of public access, wheelchair accessibility, present-day opening, or route feasibility. |

OSM supports both [sidewalk tagging forms](https://wiki.openstreetmap.org/wiki/Key:sidewalk), a separate
[bridge name](https://wiki.openstreetmap.org/wiki/Key:bridge:name), and
[legal access attributes](https://wiki.openstreetmap.org/wiki/Key:access). Those distinctions motivate preserving the
original semantics in published data. Missing attributes are data gaps; they must not be replaced with assumptions that
every road is walkable or every footpath public.

## D-03 Building shape, address, and type

Building footprints MUST preserve recognizable shape, separation, and courtyards at the default local scale.
Generalisation must not join separate buildings or fill a passage that changes the person's understanding of the area. A
footprint is geographic context; 3D extrusion is optional and must not hide addresses or paths in the default view.

Recorded addresses MUST be readable without tapping: ordinarily a house number anchored to its building/entrance,
together with a readable associated street name, provides address context without repeating the full street name on
every building. Multi-number, multi-entrance, and named addresses must retain their distinctions. Never fabricate a
number or imply that the closest street is the recorded address. Dense labels may be prioritized to avoid collision, but
address information must appear automatically at a fitting scale; metadata available only in a card does not satisfy
this requirement.

**Building type MUST be visible through the footprint's color**, accompanied by a redundant pattern, symbol, or short
type label that can be understood without a persistent key. The following semantic groups are a proposed classification
to validate; exact colors remain a design choice:

| Group                  | Meaning to communicate                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| Residential            | Housing, including houses/apartments.                                                                       |
| Commercial             | Buildings classified for shops, offices, or other commercial use.                                           |
| Civic / public service | Public administration, community, and public-service buildings.                                             |
| Healthcare             | Buildings classified for healthcare.                                                                        |
| Education              | Schools, colleges, and other education buildings.                                                           |
| Industrial / utility   | Industrial, warehouse, agricultural, and utility structures.                                                |
| Religious / cultural   | Buildings classified for religious or cultural purposes.                                                    |
| Mixed                  | Explicitly supported mixed classification; not an inferred catch-all.                                       |
| Unknown                | A building is known to exist but its type cannot be established. Neutral styling distinct from residential. |

Building details MUST say whether classification expresses **recorded structural type** or **documented current use**.
Keep those facts separate in the data: a former church can have another current use. The recommended default is
documented building-wide current use when established, otherwise an explicitly identified recorded structural type,
otherwise Unknown. A mixed provenance/style policy needs visible distinction between use-based and structure-based
classification; it must not present all colors as verified current occupancy. This follows the distinction between OSM
[building type](https://wiki.openstreetmap.org/wiki/Key:building) and
[current use](https://wiki.openstreetmap.org/wiki/Key:building:use).

A cafe, pharmacy, or shop inside an apartment block does not classify the entire footprint as commercial or healthcare.
Building-wide evidence and tenant POIs have different roles. Preserve original attributes and classification provenance,
and mark conflicts or uncertainty rather than guessing from shape, address, or nearest POI.

Color remains required, but cannot carry the meaning alone: pair it with visible non-color cues as required by
[WCAG use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html). Check essential symbols, lines, and
boundaries against adjacent colors using
[WCAG non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html); this includes the position
marker, bridge separation, and paths. Validate the combined scene in grayscale and common color-vision simulations, not
just isolated palette swatches.

## D-04 Topography and vertical separation

### The fixed 5 m requirement

**A ground-height change of 5 m or more MUST be clearly perceptible at the local default scale, without enabling a
terrain mode or selecting a feature.** This means recognizing rising/falling land, slopes, ridges, valleys, embankments,
cuttings, and cliffs where they occur, rather than merely seeing an attractive shaded background. At country scale the
representation can generalize, but the requirement remains for local views throughout the intended supported coverage.

Separate four quantities:

| Quantity             | Meaning                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Elevation            | Height of a point relative to a declared vertical reference/datum.                                                 |
| Relief               | Difference in ground elevation between locations: the user's 5 m threshold.                                        |
| Slope                | Rise divided by horizontal run. A 5 m rise over 10 m and over 500 m should not look equally steep.                 |
| Structure separation | Height/order of a bridge or road relative to ground or another corridor beneath it. Not the same as ground relief. |

The recommended default representation combines **5 m vertical-interval contours**, readable elevation labels/index
contours, restrained hillshade, and explicit scarp/embankment/steps symbols where contours cannot describe an abrupt
feature clearly. Index contours every 25 m are a proposed aid to reading. State the interval and elevation units in
appropriate contour annotations on the map, without a persistent key. Ordnance Survey's
[Explorer legend](https://www.ordnancesurvey.co.uk/documents/Explorer-Generic-Legend-English-2022-09.pdf) provides an
established example of 5 m/10 m contours and separate cliff, gradient, cutting, embankment, and crossing symbols; it
does not establish our data accuracy or dictate our styling.

Hillshade alone MUST NOT satisfy the requirement: its visual effect depends on lighting and does not label a vertical
difference. Likewise, 5 m contour spacing is a **representation interval**, not proof of 5 m detection or accuracy. On
steep terrain, avoid unreadable contour merging with explicit landform cues and readable index labels; thinning must not
hide a 5 m+ feature from the default local view. Do not substitute 10 m contours and declare the 5 m requirement met.

### Evidence needed to make the requirement credible

Use a validated **ground terrain model (DTM)** for ground relief. A surface model (DSM) includes roofs/vegetation and
can mistake buildings or trees for terrain. Record source date, coverage, license/redistribution rights, horizontal grid
spacing, horizontal and vertical accuracy, vertical datum, no-data regions, and derivation/generalisation methods.

Copernicus's
[official DEM description](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)
identifies its product as a DSM; global offerings have approximately 30 m/90 m spacing, with stated absolute vertical
accuracy below 4 m at 90% linear error and separate relative-accuracy specifications. **Our inference:** it is a
candidate for broad relief context, but its specifications alone cannot establish detection of every local 5 m change,
particularly narrow steps, cuttings, and urban slopes. Interpolating a coarse model to a finer grid does not supply the
missing observations.

Before claiming compliance, the data team MUST establish detectable horizontal feature sizes and local relative vertical
uncertainty using independent reference measurements. A proposed screening target is local **height-difference error ≤2
m at 95% confidence**, tested across urban, vegetated, flat, and steep terrain; this is our engineering proposal, not a
property of an acquired dataset. Passing this statistic alone is insufficient: narrow features and omissions need direct
tests. This document does not introduce a minimum horizontal width that silently excludes difficult 5 m changes.

Every reference 5 m+ feature in the declared acceptance area must be detected and legible. If available sources cannot
support the requirement, record the unsatisfied coverage/accuracy explicitly and keep it as a release gap. Unknown
terrain is not flat terrain. A limited-area demonstration must name its area; it cannot establish countrywide
fulfillment.

The Montenegro Real Estate Administration
[lists topographic data among its services](https://www.gov.me/en/article/services). This identifies a source to
investigate, **not** confirmed access to a suitable DTM, validated accuracy, or permission to redistribute it. No
terrain dataset is acquired or licensed by this documentation task.

### Roads and bridges above or below the ground

Bridge/viaduct/raised-road and tunnel/underpass geometry MUST have distinct, automatically visible structure cues: for
example deck casing/abutments and correct overdraw order for raised sections, and dashed/portal treatment for
underground sections. A shadow alone is insufficient. Maintain visible ground/water context below the span and do not
draw an at-grade junction where none exists. Include transitions back to grade and known connectors between levels.

All known grade separation must be shown; the requirement is not restricted to structures with measured height. Where a
deck is known to be **5 m or more above local ground**, that substantial separation MUST be apparent. If the relative
height is measured and trustworthy, a suitable local label such as “+8 m above ground” can explain it. Otherwise
communicate “bridge / above” without inventing a metric height.

OSM [layer](https://wiki.openstreetmap.org/wiki/Key:layer) gives relative ordering at crossings, not metres;
[elevation](https://wiki.openstreetmap.org/wiki/Key:ele) is referenced height, not clearance. Never convert `layer=1`
into “+5 m,” infer a bridge's deck height from the terrain beneath, or equate vehicle headroom restrictions with ground
elevation. Metric deck-to-ground differences need compatible reference systems, location, and measurement provenance. A
2D map can satisfy level legibility; 3D is optional and is not evidence of correct physical height.

## D-05 Points of interest without clutter

Businesses, landmarks, attractions, and useful facilities MUST be part of the default scene, with visibility governed by
**scale, geographic significance, and available screen space**. Data category alone is not significance: every
attraction is not nationally important, and a large number of cafes does not make a cafe cluster a country-level
landmark.

[Stable POI visibility](../features/poi-visibility.md) refines the icon stability policy below. Its fixed levels and
cumulative admission supersede viewport-dependent icon thinning.

1. Give each eligible POI a documented importance class and minimum display scale. Country/region views MUST suppress
   ordinary local cafes, restaurants, shops, and their count clusters. A genuinely nationally significant site needs
   evidence for that rank, not a permissive category-wide rule.
2. Apply each place's fixed level threshold **before** label collision placement. Icon admission is cumulative as zoom
   increases and independent of viewport occupancy; country-level aggregates of ineligible businesses remain clutter.
3. At street scale, show a representative, readable selection of local businesses and sights automatically. Use
   recognizable category symbols and names when space permits, rather than an undifferentiated carpet of circles.
4. Establish deterministic label priorities: protect current position, movement/bridge names, meaningful terrain/level
   cues and address context before ordinary POI names; preserve salient geographic landmarks. Names may yield to those
   priorities, but their collisions must not remove eligible icons. Avoid duplicate labels for one place represented by
   both a footprint and point.
5. Symbols and text MUST NOT overlap into unreadable piles or hide essential paths. Control density through reviewed,
   persistent level assignments rather than viewport-dependent icon suppression. Screen size does not change a place's
   threshold. Co-located listings require a stable shared marker and access to each listing; essential map readability
   remains a real-data release check, not something proved by stable eligibility alone.
6. Suppression from the default scene MUST NOT delete directory data. Search may deliberately surface a requested cafe
   at broad scale; explicit search/selection is a later interaction, visually distinct from ordinary default
   cartography.

The [MapLibre symbol specification](https://maplibre.org/maplibre-style-spec/layers/#symbol-sort-key) provides
scale/placement controls and priority ordering. Those are implementation tools; they do not choose our importance
classes or prove a legible scene. The product requirement applies to icon footprints and the entire map, including
symbols that do not participate in text collision placement.

## D-06 Current position and honest uncertainty

Current position MUST be a first-view capability. A center crosshair, default Podgorica camera, route endpoint, stored
map center, or inferred IP area MUST NOT impersonate it.

Web location requires user permission and a secure context; the browser may return an error or no fix. The
[W3C Geolocation specification](https://www.w3.org/TR/2026/CRD-geolocation-20261030/) exposes position time and an
accuracy radius. Therefore literal visibility of an actual location before permission or acquisition cannot be
guaranteed. The required first-view result is either an automatically displayed usable fix **or an explicit location
state**. This is an environmental constraint, not removal of the position requirement.

Use the [icon-only location presentation](../features/interface.md#ui-05-honest-state-with-minimal-interruption):
visible icon/marker differences and accessible names communicate state without a persistent text banner. A usable fix
recenters directly on activation; no introductory location panel is required. If positioning cannot succeed, show
concise actionable recovery after the location request. Do not hide a failure or substitute a fabricated position to
keep the UI quiet.

The following are **our product decisions** for that capability:

| State                                             | Required default experience                                                                                                                                                                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permission already granted                        | Begin obtaining position on opening; show acquisition through icon/accessibility state, then marker and uncertainty automatically. No extra “locate me” click is required.                                                                      |
| Permission not yet decided                        | Identify the location action accessibly and initiate the browser's permission flow where allowed. If a gesture is required, the location button provides it. The rest of Discover works while the person decides.                               |
| Usable fix                                        | Show a distinctive position marker and ground-scaled accuracy circle; keep it distinguishable from POIs and A/B endpoints. Show age/quality in an accessible status. Do not snap the raw marker to a road or building and hide the uncertainty. |
| Low accuracy                                      | Show the reported uncertainty and distinct approximate icon/marker state with accessible accuracy; do not imply the device is inside a particular building or on a particular side of a road.                                                   |
| Old fix / updates lost                            | Make the stale icon/marker visually distinct and include last-update age in accessible state; do not continue calling an old point current.                                                                                                     |
| Denied / OS service off / unsupported / timed out | Distinguish the unavailable state in the icon and accessible name. On a location action, name the relevant condition and offer appropriate recovery. No repeated permission loop and no fabricated marker.                                      |
| Outside map coverage                              | Distinguish outside-coverage state through the icon and accessible status; retain covered-map context. Explain the limitation when the location action cannot recenter into supported detail.                                                   |

Proposed initial tuning: accept a fix as fresh for at most **30 s**, request acquisition with a **15 s** deadline, and
mark horizontal accuracy worse than **50 m** as approximate. A tighter reported radius must still be drawn truthfully;
50 m is a display-state threshold, not a guarantee that smaller errors identify a building. Validate these values on
supported devices before treating them as release parameters.

Location acquisition MUST NOT block other map layers. A late fix must not pull the camera away after the person starts
exploring; keep the marker available and provide a recenter action. Do not add background travel tracking as part of
Discover. Keep coordinates in session memory, do not record a location history or add it to offline
packages/analytics/server logs, and do not send it to routing merely by opening the map. Browser/OS location providers
may use their own services; “no app-side upload” is not a promise that the device can locate itself without a network.
Sending a selected location for a later route is a separate Plan action.

## D-07 Data coverage, ownership, and current gaps

These requirements target the intended Montenegro map; they are not restricted to the current central-Podgorica dataset.
A staged local rollout can demonstrate them in a named area, while broader coverage stays an explicit gap. Missing
source data or an unknown classification is not proof that a real-world feature is absent. Display unknowns honestly and
track completeness separately from the correctness of known features.

The audit below records the **1 November 2026 geographic baseline** after the first web-only Discover pass. It does not
describe the target as implemented: every row still has work that depends on data the published snapshot does not
contain.

The interface approved on 3 November is implemented in the web source: stable expanding controls, icon-only location,
and mobile search with fixed categories over a scrolling list. The nearest search result uses the existing place feature
with protected icon visibility. Existing key/banner behavior below is historical baseline evidence; see
[the current interface](../features/interface.md) for control behavior. Data coverage and default POI importance gaps
remain.

| Requirement         | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Work needed to meet the target                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 Default view   | [App startup](../../../apps/web/src/app.js) opens central Podgorica at ≈1 m/CSS px (`DISCOVER_ZOOM` in [core](../../../apps/web/src/core.js); the former zoom 14 was ≈3.5 m/px and hid house numbers and POI names). The base map is created before places and house numbers finish loading; each failed layer gets its own message. A small map key is visible without interaction. The From/To prompt moved out of the default view into About.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Validate the implemented laconic interface on physical phones. Building types, terrain and level separation still need source data and readable encodings. Readiness instrumentation and performance baselines do not exist.                                         |
| D-02 Movement       | [Style](../../../packages/map-core/src/map-style.js) gives footways, pedestrian streets, paths/tracks, cycleways and steps their own colours and dash patterns, and service streets a narrower stroke. Published [roads](../../../data/sources/roads.geojson) still retain only `kind` and `name`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Recover/preserve sidewalk, bridge/`bridge:name`, tunnel, layer, oneway, access, crossing and construction semantics through the producer and contract; then draw structure, restriction and sidewalk cues. Rail/ferry context is not in the snapshot.                |
| D-03 Buildings      | Published [footprints](../../../data/sources/buildings.geojson) contain generic `kind=building`, so all footprints keep one neutral fill and the key says the type is not recorded. Published [address labels](../../map-data/building-numbers.md) (1,076) show automatically at the default scale.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Source-backed use/structure classification with provenance; colour plus non-colour cue per group; richer address coverage and street association.                                                                                                                    |
| D-04 Terrain/levels | No elevation, contour, hillshade or terrain source. The key states that terrain and bridge levels are not in this map yet, rather than letting flat cartography imply flat ground.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Suitable licensed ground data, structure semantics, validated height/coverage, derived local offline assets, and terrain/level cartography.                                                                                                                          |
| D-05 POIs           | [App layers](../../../apps/web/src/app.js) no longer cluster. One collision-placed symbol layer with runtime-drawn [category icons](../../../packages/map-core/src/poi-icons.js) sits below road names and house numbers, so those win collisions. A scale filter hides every POI at country/region scale, shows sights/essentials from ≈7 m/px and other categories from ≈3.5 m/px. An explicit search or category choice lifts the scale filter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Places have no importance rank: the per-category rule is a stopgap, and all 622 `sights` are treated alike. Add producer-side ranks and minimum scales; make search results visually distinct from default cartography; run density/stability reviews at every band. |
| D-06 Position       | [Position tracker](../../../apps/web/src/position.js) starts on load (granted: no click; prompt: browser asks, with a visible retry). The status shows acquiring, live, approximate (>50 m), stale (>30 s), denied, unavailable, timeout (15 s), insecure, unsupported and outside-coverage states. A ground-scaled accuracy ring is drawn. The camera centers once unless the person has already moved it. The position button starts following the current location on click: new fixes keep the camera centred, preserving zoom. Following stops on a second click, when the person moves the map, or on any app-initiated camera move (search result, layer toggle). It does not stop on a map resize. The button colour turns green while following; `aria-pressed` and `data-following` reflect the state. If location fails or the permission prompt is dismissed while following, following stops. Coordinates stay in memory only. | Validate thresholds on supported devices. Coverage is the Montenegro map bounds; a "limited detail" state for areas outside central Podgorica is not distinguished yet.                                                                                              |

Data owns acquisition, provenance, semantic preservation and validated releases. Web owns default camera, rendering,
geolocation and communication of uncertainty. Shared producer/consumer formats belong to
[contracts](../../../packages/contracts/README.md); acceptance belongs to
[cross-component tests](../../../tests/README.md). Follow [ownership](../../system-architecture/ownership.md). Extending
data must update producer validation and consumer tests together, with a deliberate release; no placeholder backend,
server search, or editorial API is required by this specification.

All geographic layers needed for Discover must be distributable as local runtime assets and included in the verified
offline package, subject to licensing. Do not silently add a remote terrain dependency that breaks the core offline
view. The first implementation pass changed web rendering only: no source refresh, geography regeneration, or contract
change has occurred.

## D-08 Acceptance and evidence

Use reference areas with independently reviewed ground truth, not just attractive screenshots: a dense Podgorica block;
named bridge and stacked crossing; tagged and separately mapped sidewalks; steps and a narrow pedestrian link; mixed
building uses and courtyards; flat ground next to a 5 m rise; steep/narrow terrain; a rural/mountain area; sparse
coverage; and a dense business district. Synthetic fixtures establish rendering behavior; real reference areas establish
source adequacy. Current data cannot supply every required case.

For the opening-view checks, the page loads with no subsequent app interaction. Permission decisions are the only
unavoidable user-mediated exception; also run an already-granted case that requires none. Record each fixture's ground
scale, viewport, coverage version, location state, and visible control bounds.

| ID   | Check                                                                                                     | Pass condition                                                                                                                                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A-01 | Open locally with a granted, fresh test fix.                                                              | At default scale the five classes appear together where present, including position/accuracy, with no feature click, search, download, or layer activation.                                                                                                                                            |
| A-02 | Open with pending/denied/timed-out/no location; repeat offline.                                           | Network/building/terrain/POI content remains usable; icon and accessible location state identify the condition; recovery is available on a location action; no false position or silent blank data.                                                                                                    |
| A-03 | Read a street, its bridge, a sidewalk, a path and stairs.                                                 | Names and mode distinctions are visible; a person can trace the mapped pedestrian connections and distinguish a bridge from an at-grade crossing without tapping.                                                                                                                                      |
| A-04 | Compare a true junction, an overpass, a tunnel and a raised section.                                      | Correct order and connectors; no false junction; known 5 m+ structural separation is legible. Unknown physical height is never rendered as an invented number.                                                                                                                                         |
| A-05 | Read recorded addresses and building types.                                                               | House number and correct street association are visible in the initial fixture; footprint colors and redundant cues correctly distinguish known types and Unknown without a persistent key. A tenant cafe does not recolor the whole apartment block.                                                  |
| A-06 | Compare independent 4 m, 5 m and 10 m ground changes, including long slopes and narrow abrupt features.   | Every 5 m+ reference feature remains perceptible at default local scale; direction and steepness are interpretable; a flat control is not depicted as a slope. The 4 m case may be shown, but must not be mislabeled as ≥5 m.                                                                          |
| A-07 | Zoom from default to country and back.                                                                    | Ordinary cafes/shops and their count clusters disappear at broad scales; ranked landmarks remain where appropriate; local details return automatically, without deleting directory entries.                                                                                                            |
| A-08 | Inspect a dense map at each scale and apply small pans.                                                   | No unreadable symbol piles or critical label collisions; roads/paths, address context, terrain and position remain readable; priorities are deterministic and stable.                                                                                                                                  |
| A-09 | Supply low-accuracy, stale and late fixes; pan before the late fix.                                       | Uncertainty/state is honest; old fixes are marked; the late update does not override the person's exploration camera. No app-side location persistence or upload occurs.                                                                                                                               |
| A-10 | Reopen a verified offline package with network disabled.                                                  | Required geographic layers/labels/symbols remain; position follows the device/permission state and does not masquerade as cached geographic content.                                                                                                                                                   |
| A-11 | Repeat at desktop 1280×800 and phone 412×840, around the 720px breakpoint, and on physical target phones. | Same semantic meaning, readable map, location icon states and controls; verify portrait/landscape, grayscale/color-vision simulations and reduced motion. Browser emulation alone is insufficient.                                                                                                     |
| A-12 | Ask a person to describe the untouched scene.                                                             | They can identify position/uncertainty or its unavailable state, a usable mapped corridor, a building/address/type, the direction of a 5 m+ change, a level-separated crossing, and a relevant POI where those features exist. Record mistakes and time; there is no measured user-study baseline yet. |

Release evidence needs three separate verdicts: **source adequacy**, **rendering correctness**, and **user
comprehension**. Existing tests in [the testing guide](../../verification/testing.md) cover parts of the current map,
not these new acceptance criteria. Control composition and expansion also need the
[interface acceptance cases](../features/interface.md#acceptance). Add targeted producer/contract checks, deterministic
browser fixtures and visual review when implementing, then conduct observed tasks and physical-device checks. A source
property existing in a file, a successful tile request, or a passing screenshot comparison alone does not establish
Discover success.

## Decisions before implementation

The user has fixed the five classes, their default visibility, the 5 m relief threshold, and scale-appropriate POIs.
Research supports generalisation, preserving source semantics, separating terrain from structure height, and exposing
location uncertainty. The following remain implementation decisions, not reasons to postpone the requirement:

- Select and license adequate terrain/structure/address/building-type sources; establish real coverage and accuracy,
  including narrow 5 m+ features.
- Validate the proposed building groups, provenance cues, redundant encodings and map labels with representative users.
- Tune the proposed scale bands, starting scale, POI ranks/density and location thresholds against reference scenes and
  physical phones.
- Name reference devices/connections and establish readiness/performance and user-task baselines before setting final
  numeric release budgets.

Future implementation plans must name the affected D-/A- requirements and their evidence. Do not treat a style-only
improvement as completion where the underlying data still cannot answer the question.
