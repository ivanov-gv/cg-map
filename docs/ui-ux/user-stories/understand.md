# Understand: details in one selection

Status: target product requirements, agreed direction on 1 November 2026; **not a description of completed
implementation**. This stage follows [Discover](discover.md) in **Discover → Understand → Plan → Travel**. It requires a
deliberate user intention: selecting something in the map to learn more about it.

This target builds on [US-04 and US-05](user-stories.md): judge a listing and understand the selected map object.
Current selection behavior is described in the [point-selection feature](../features/point-selection.md); target
requirements below identify where richer details or evidence remain unimplemented.

## Purpose, stories, and success

**As someone looking at the map, I want to click an object or point and inspect its available details, so I can
understand what I saw and how it relates to its surroundings.**

| Requirement / story            | Observable success                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U-01 Access details            | One click/tap opens the selected object's available details and an unambiguous geographic highlight. No intermediate preview or second “More details” action is required. |
| U-02 Inspect a building        | I can relate the full contour to its addresses, recorded entrances, type, and known POIs inside, with missing or uncertain information identified.                        |
| U-03 Inspect any point         | I can read the selected coordinates, available geographic context, and nearest recorded address with its distance and relationship clearly stated.                        |
| U-04 Inspect a POI             | I can read its name, category/type, recorded hours, location/address, and other available information without confusing the business with its containing building.        |
| U-05 Inspect other map content | A road, bridge, path, landmark, park, water feature, terrain feature, stop, cluster, or position symbol has meaningful detail appropriate to what was shown.              |
| U-06 Trust the information     | I can distinguish source-backed facts, inferred associations, nearby context, unknowns, and dated or live information.                                                    |
| U-07 Return to exploration     | I can close or change selection and continue exploring without losing my context or accidentally starting a journey.                                                      |

**MUST** denotes a requirement; **SHOULD** denotes a recommended design with a documented reason for alternatives.
“Available” means user-relevant information in the published dataset or already supported feed, with provenance and a
valid association to the object. It does not authorize invented details, an incidental upstream refresh, or the claim
that missing information does not exist in reality.

## U-01 One-click access from Discover

1. Every individually visible object presented by Discover MUST be inspectable with one deliberate click/tap on its
   visible geometry, icon, or label. A label and its corresponding shape MUST resolve to the same identity. A
   keyboard-equivalent selection MUST be available; hover or a precision long press cannot be the only access path.
2. The selection MUST open the detail view directly, with all available user-relevant fields for the subject accessible
   together. Scrolling is allowed. Required information MUST NOT be hidden behind another “Details” button, collapsed
   section, tab, sign-in, or external website. Optional actions and links supplement the view; they cannot substitute
   for its content. Large lists may render progressively while scrolling without a mandatory “Load more” click.
3. The view MUST identify the subject, show its geographic highlight/context, and present information appropriate to its
   type. Its title and selected coordinates MUST not silently change to a nearby object. If details load asynchronously,
   show the subject/highlight and loading state first, then fill the same view without another action. Show a specific
   failure and recovery action when data cannot load.
4. Hit testing MUST follow the visible scene. A POI symbol selects that POI; an exposed building footprint selects the
   building. Touch tolerance must help small targets without allowing an invisible oversized hit box to steal another
   visible target. For genuinely overlapping geometry, the first click MUST show the selected subject's details and
   identify overlapping context in the same view; a chooser cannot be the only first-click result. Switching to another
   related object is a new inspection intention, not a prerequisite for the first subject's details.
5. A cluster is an aggregate subject. Its first-click response MUST explain count, area and available member summary; it
   may also zoom. Zoom alone is insufficient detail. Selecting an individual member later opens that member's details in
   one action. This does not require displaying every hidden POI on the Discover map.
6. A background click MUST inspect that point. Pan, pinch, double-tap zoom and tap-drag gestures MUST retain their map
   behavior without accidental selections. Gesture recognition may delay a single tap; it must not turn it into a second
   required action.

The initial map remains Discover until selection. Understanding MUST NOT require search, a route mode, an endpoint, live
vehicles, or location permission. Search results, when used, SHOULD reach the same subject and details as direct map
selection.

## U-02 Building details

Selecting a building MUST reveal building-level information and its relationships to entrances and POIs, without
substituting the nearest tenant as the building's identity.

| Detail                | Required behavior                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contour / footprint   | Highlight the complete selected boundary, including holes and multiple parts, rather than a vector-tile fragment or bounding rectangle. Here “contour” means the building outline, distinct from elevation contours in Discover.                                                                                                    |
| Identity and type     | Show the recorded name if any, structural type/current-use classification and its meaning, and sourced attributes such as levels or height when available. An unnamed building stays unnamed; a cafe inside does not rename or reclassify it.                                                                                       |
| Address               | Show recorded street/place, house number/name, and other available components. Preserve multiple addresses and their association to entrances or parts; do not collapse them into one invented building-wide address.                                                                                                               |
| Entrances             | Automatically mark recorded entrance locations on/around the selected contour and list available name, reference, type, level and access attributes. Explain which building, unit or POI an entrance serves when established.                                                                                                       |
| POIs inside           | List known associated businesses/facilities with names, category, recorded hours, address/unit/level and other available user-relevant details in the same view. A count or tenant-name list requiring another click for every tenant's information is insufficient. Optional direct tenant inspection must agree with these facts. |
| Provenance and limits | State source/snapshot context and missing or ambiguous relationships. “Entrances not recorded” and “No POIs recorded for this building” must not imply there are no entrances or occupants.                                                                                                                                         |

Entrance geometry must come from a recorded entrance, not an arrow guessed from the nearest road or a facade center. A
recorded entrance is not automatically the main, public, step-free or currently open entrance. OSM distinguishes
[entrance types and attributes](https://wiki.openstreetmap.org/wiki/Key:entrance); the presentation must retain these
meanings. No access route or line to an entrance is computed in this stage.

Building-to-POI and building-to-entrance associations MUST record their evidence. An explicit source relationship or
reviewed unambiguous geometry can establish an association. If geometry is the only basis, describe the POI as “mapped
within this footprint” rather than verified indoor occupancy. Boundary points, overlapping footprints, adjacent
buildings, building parts and multi-level spaces need ambiguity handling. Keep nearby POIs separate from associated
occupants. Missing indoor data must not be filled with inferred floors, units or tenants.

The contour and entrance markers MUST remain understandable with details open, including on a phone. A list-only
entrance description is insufficient when locations are recorded. Unknown locations remain a stated gap, not invented
markers.

## U-03 An arbitrary point and its nearest address

The subject is **the clicked point**, not the user's current location, map center, nearest building centroid, or lookup
result.

The view MUST show latitude/longitude with labeled order and appropriate display precision; retain the actual selected
coordinate internally. Show a point marker and available context, such as a containing building/area, nearby named
road/bridge, or supported elevation and its source. Do not invent locality, elevation, identity or access conditions
from the map's appearance.

| Address relationship                          | Required presentation                                                                                                                                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recorded for a selected/containing object     | Identify the object and source-backed relationship. A point inside a footprint is not a newly addressable object; multiple recorded addresses remain multiple.                                                  |
| Nearest recorded address                      | Label it **Nearest recorded address**, show approximate straight-line distance from the clicked point to its recorded address anchor, and state that it is nearby context, not necessarily the point's address. |
| Partial, tied or ambiguous                    | Mark missing components and ambiguity or equal candidates. Do not silently choose a unit/entrance or manufacture a number.                                                                                      |
| No usable nearby record / incomplete coverage | Show coordinates and other available context, plus a specific unavailable state. A distant address must not masquerade as a useful local answer.                                                                |

Nearest-address lookup MUST consider the relevant published inventory, independent of visible labels, category/search
filters, and zoom. Measure consistently from the clicked coordinate to recorded address anchors: address points,
entrances, or explicitly identified representative building anchors. State anchor type where it changes interpretation;
a representative building point is not a surveyed entrance.

A proposed initial search bound is **250 m**, to validate in urban and rural reference areas. This is a tuning
candidate, not an accuracy standard or implementation claim. State the bound when no result is found. “Nearest” means
nearest eligible record in the available dataset within the declared bound, not proof of the nearest real-world postal
address. Do not use route distance, the map center as origin, or false precision to hide tied/partial results.
Deduplicate representations of one address without merging distinct addresses.

A nearby address across a river, wall or bridge level remains geographic context; this stage does not assert
reachability or produce a route. OSM [address semantics](https://wiki.openstreetmap.org/wiki/Key:addr) allow addresses
on buildings, POIs, entrances and independent points, motivating the distinction between address ownership and
proximity.

External reverse geocoding is not assumed.
[Nominatim's documentation](https://nominatim.org/release-docs/latest/api/Reverse/) explains that its reverse result
uses a closest suitable indexed object and can refer to a different street. That is evidence for careful labeling, not a
decision to add Nominatim or an API. The target needs a deliberate local address/context capability usable in a
downloaded package; its design and contract remain implementation work.

## U-04 POI and business details

A POI's marker, label, or distinct mapped geometry MUST expose its own information:

| Information           | Required behavior                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name and category     | Show the source name, available alternate names and a human-readable category/type. Keep the POI distinct from a building, address, or unrelated business at the same location.                                                                                                            |
| Opening hours         | Show recorded hours in understandable form, including supported day/season/special-day exceptions and notes. Say when hours are unrecorded or uninterpretable; do not imply closed or invent a timetable. Preserve access to the source expression without making it the only explanation. |
| Location and address  | Show coordinates and recorded address/unit/level, with building/entrance associations when known. Separate nearest-address context from the POI's own address.                                                                                                                             |
| Other available facts | Include sourced contacts, website, relevant access/facility attributes, description and source link where present. Empty fields must not become invented defaults or claims of absence.                                                                                                    |
| Freshness             | Identify source/snapshot context and possible staleness. Dataset retrieval is not a verified opening-hours or business-status check date.                                                                                                                                                  |

The [opening-hours data convention](https://wiki.openstreetmap.org/wiki/Key:opening_hours) supports rules and exceptions
beyond a weekly timetable, motivating deliberate parsing and uncertainty handling. “Open now” is not required; if later
offered, it must use the place's local time/calendar, supported rules and valid device time, and be qualified as a
schedule-derived estimate rather than live confirmation.

The same POI MUST retain identity and facts when reached from the map, directory, or building's occupant list. Avoid
duplicate records for one business represented by point and area. Distinct businesses sharing an address must remain
distinct.

## U-05 Other content shown by Discover

The subject determines its information rather than forcing every feature into a business card.

| Subject                                          | Meaningful available detail                                                                                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Road, path, pavement or steps                    | Name/type, mapped access/mode/direction, surface or step/level information where recorded, and line highlight. No route or unsupported accessibility guarantee.                  |
| Bridge, tunnel or crossing                       | Structure name/type, what is above/below, recorded level/height provenance and access. Relative layer order is not metric height.                                                |
| Park, land or water area; landmark               | Name/type, full selected geometry and available source-backed description, access or facilities. No invented hours for an unnamed natural feature.                               |
| Terrain contour, elevation label or ground point | Represented elevation/interval or supported sampled ground value, units/reference/accuracy context and source. Hillshade alone cannot yield exact height.                        |
| Bus stop or station                              | Recorded name/reference, source/snapshot and available facilities/access. No departure prediction or journey search is initiated.                                                |
| Live vehicle, when shown                         | Available route, feed-check/freshness context and derived-direction uncertainty. No invented identity, GPS timestamp, arrival or speed. Live data stays outside offline storage. |
| Current-position symbol                          | Coordinates, uncertainty and age/state as specified in [Discover](discover.md#d-06-current-position-and-honest-uncertainty). No route request or location history is started.    |
| Aggregate / cluster                              | Count, geographic extent and available member summary; clearly an aggregate, not a single place.                                                                                 |

A continuous surface rather than an individual object opens point context for that surface. A disabled optional layer
does not create invisible hit targets. Every enabled, individually represented subject must satisfy U-01 using its
actual facts.

## U-06 Trust, unknowns, and offline detail

The view MUST distinguish source-backed attributes, inferred associations, approximate nearby context, and unavailable
data. Preserve conflicting claims with context rather than silently choosing an unqualified answer. Source links
supplement the local explanation and may need a connection; they are not prerequisites for understanding downloaded
facts.

All published static detail needed here, including address lookup records, entrances and occupant relationships when
implemented, MUST be included in the verified offline package. Offline inspection must not silently substitute a sparse
view lacking detail promised by that package. An unsupported/partial package or lookup failure needs an explicit state.
Live vehicles may be unavailable offline; saved stops/buildings/POIs remain inspectable. Do not cache live positions or
external routes to fill gaps.

Nearest-address and related-object work must be cancellable or selection-scoped: a late response for a previous building
must not overwrite a newly selected point. Selecting a point does not authorize sending its coordinate to an external
lookup provider. No provider, backend endpoint, editorial service or account is introduced here.

## U-07 Continuity and the boundary with Plan

Opening details MUST NOT select From/To, alter existing endpoints, calculate/retry routes, enable live transport, or
start navigation. Entrances explain recorded locations without directions. Nearby-address distances are descriptive
measurements, not itineraries. **Understanding is complete without creating a trip.**

A later explicit planning action is a separate stage transition defined in [Plan](plan.md). Current From/To buttons are
documented in [point selection](../features/point-selection.md); this target does not require route controls in
Understand or change runtime behavior by itself. Existing Plan capabilities must not be removed incidentally when
improving selection; changes to stage transitions must satisfy the
[Plan acceptance criteria](plan.md#acceptance-and-user-success-evidence).

Keep enough map visible to relate the subject to its surroundings. Move the camera only as needed to expose selected
geometry; do not make a point click jump to its nearest address. Distinguish the subject from related buildings,
entrances and nearby addresses, with a key where needed and non-color cues. Changing zoom, tiles or panel size must not
change which subject/address is explained.

Closing or Escape MUST clear inspection highlights/related markers, restore the Discover scene and return focus
appropriately. Selecting another subject replaces its inspection overlays instead of accumulating unrelated pins.
Preserve search/category and independently established planning state unless explicitly changed. Support scrolling,
close controls, keyboard-equivalent selection and reduced motion under the [UI guidelines](../../engineering/ui.md).

## Current implementation and ownership gaps

This audit describes the reviewed snapshot on 1 November 2026, not the target as implemented.

| Area             | Current evidence                                                                                                                                                                                                                | Target gap                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct selection | [App cards/hit testing](../../../apps/web/src/app.js), [point descriptions](../../../apps/web/src/point-selection.js) and [highlighting](../../../apps/web/src/object-selection.js) support places, stops, geometry and points. | Full subject coverage, aggregate/overlap details, complete composition and keyboard reachability need verification/implementation.                              |
| Buildings        | Full-footprint highlighting and some [recovered addresses](../../map-data/building-numbers.md) exist; legacy footprints have generic building classification.                                                                   | No published entrance inventory or occupant relationship model; richer attributes and related detail remain data/UI work. Current selection draws no entrances. |
| Generic points   | Coordinates and available feature attributes are shown; the [current guide](../features/point-selection.md) states no reverse geocoder is used.                                                                                 | Nearest-address lookup and comprehensive context are new capabilities, not existing card behavior.                                                              |
| POIs             | Names, category/kind, available addresses, source hours expression, contacts and safe website/source links are displayed.                                                                                                       | Readable hours with uncertainty and complete building/entrance context remain implementation work.                                                              |
| Plan separation  | Current cards expose From/To; choosing both can calculate a route.                                                                                                                                                              | Inspection itself must remain free of planning side effects; stage-transition design stays separate.                                                            |

Data owns reviewed addresses, entrances, building/POI identity and relationship evidence. Web owns hit testing,
details/highlights, local lookup and selection state. [Shared contracts](../../../packages/contracts/README.md) own
producer/consumer formats; new semantics need producer validation and consumer tests together. Follow
[ownership](../../system-architecture/ownership.md), preserving legacy identity/provenance constraints. A showable
detail does not by itself require a backend.

## Acceptance and user-success evidence

These are target scenarios, not claims that the current suite covers or passes these new requirements.

| ID    | Scenario                                                                                             | Pass condition                                                                                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UA-01 | Click a building, POI icon/label, path and bare point from Discover.                                 | First action opens corresponding details/highlight directly. No preview-only view, forced chooser or second “Details” action; fields and related lists need only scrolling. |
| UA-02 | Inspect a building with courtyard, multiple tiles and recorded entrances.                            | Full contour/holes stay correct across zoom; entrances appear automatically in correct locations with recorded attributes. No guessed arrows/routes.                        |
| UA-03 | Inspect a multi-address building, several occupants and an adjacent unrelated POI.                   | Correct address/entrance associations; occupants' information in the same view; nearby POI not asserted inside; ambiguous geometry labeled.                                 |
| UA-04 | Click near an address across a river; hide labels and change filters.                                | Click coordinates remain the subject; nearest available address/distance is consistent, labeled nearby context, with no ownership/reachability claim.                       |
| UA-05 | Inspect tied/partial addresses, multiple entrances, no result within bound and incomplete coverage.  | Ambiguity/missing information explicit; no arbitrary unit, distant fallback, fabricated address or false completeness claim.                                                |
| UA-06 | Inspect businesses with exceptions, missing/unsupported hours and outdated information.              | Name/category and readable supported hours; uncertainty explicit; unknown schedules never become “closed now.”                                                              |
| UA-07 | Inspect one POI through map, directory and building context.                                         | Identity/facts agree; distinct co-located businesses stay distinct. A new subject selection is not required to reveal the original subject's details.                       |
| UA-08 | Click bridge, park, stop, terrain, cluster and available position/vehicle symbols.                   | Subject-appropriate detail, clear aggregate/surface meaning, no invented height, GPS age, opening hours or arrival.                                                         |
| UA-09 | Change selection during loading; encounter detail/lookup failure.                                    | Old responses cannot overwrite the subject; known details remain, with specific loading/error and recovery states.                                                          |
| UA-10 | Reopen a verified offline package; inspect building, entrance, POI and point.                        | Published detail, relationships and nearest-address capability remain available; unknowns/failures honest, external links optional, no silent external lookup dependency.   |
| UA-11 | Inspect/scroll/switch/close on desktop, 412×840 touch, keyboard, reduced motion and physical phones. | Subject, highlight, related features, readable map and close/focus remain usable; pan/double-tap/tap-drag do not accidentally select.                                       |
| UA-12 | Inspect with no route points and with an existing independent plan.                                  | No endpoint/route mutation, routing request, mode change or navigation; closing returns to Discover preserving independent state.                                           |

For observed tasks, ask people to identify a building's contour/address/entrances, describe its recorded occupants,
explain a point's nearest address, and read a business's category/hours. Record first-selection correctness, actions
needed to reach detail, mistaken associations, recognition of unknowns and return to exploration. The outcome is
**correct understanding after one selection**, without planning. No completion-rate or timing baseline has been
measured.

Evidence must separately establish source adequacy, correct associations/selection, usable presentation and user
comprehension. See [testing](../../verification/testing.md) for commands/device limits; current tests prove only what
they cover. Implementation plans must name affected U-/UA- requirements and unsatisfied data/coverage gaps.
