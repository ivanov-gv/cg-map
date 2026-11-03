# User intents, stories, and success

Product baseline extracted from the current UI on 1 November 2026. Use this when changing the experience: preserve the
outcomes below, while allowing the controls and layout to improve. This is an implementation-derived baseline, not
validated user research. New target requirements are documented separately from implemented behavior.

## Product purpose

Help someone exploring Montenegro find and understand a place, choose a useful next step, and retain useful map access
when connectivity disappears. Success means the person can act on the information **and understands its limits**.

The strongest current coverage is central Podgorica. Country-level exploration is supported with less detail elsewhere.
The product is a read-only map and directory with route planning; its [current architecture](../../ARCHITECTURE.md)
defines the implemented scope.

## Product journey

The agreed direction is **Discover → Understand → Plan → Travel**. These stages describe the person's progress, not four
screens or a requirement to follow a rigid sequence.

| Stage      | User intent                                                                                          | Success / next step                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discover   | See my position, surroundings, movement network, buildings, terrain, and relevant places on opening. | The default scene supplies enough context to notice a place or way to explore. [Discover requirements](discover.md) define the target, research basis, and current gaps.   |
| Understand | Inspect an object or point deliberately selected from Discover.                                      | One selection reveals its available details and context without planning. [Understand requirements](understand.md) define building, point, POI and related-object success. |
| Plan       | Choose endpoints and a travel option.                                                                | I can compare supported options and understand the selected itinerary and its limits.                                                                                      |
| Travel     | Act on the chosen plan in the real world.                                                            | I can use the chosen map/plan to proceed; ongoing guidance, tracking, and navigation require a separate specification and are not claimed as implemented.                  |

The default Discover information classes/current position and one-selection Understand details are approved target
requirements, not claims that the current UI already satisfies them. See [Discover](discover.md) and
[Understand](understand.md) for the targets and gaps. Existing stories below describe the capabilities to maintain while
building toward those targets.

## Usage contexts

Three plausible usage contexts guide the stories. They are hypotheses to validate, not established audience segments:

- Someone unfamiliar with an area wants to discover somewhere to eat, visit, shop, stay, or find essentials.
- Someone with a destination in mind wants to identify its location and compare ways to reach it.
- Someone expecting weak connectivity wants to prepare before leaving and continue exploring afterward.

## Stories to maintain

All rows describe capabilities present today. IDs let future changes and acceptance criteria refer to the affected
outcome. They do not impose a priority ranking or freeze today's wording, colors, or panel positions.

| ID    | User intent and story                                                                                                                                                       | Observable user success                                                                                                                                                                                                                                              | Boundary to preserve                                                                                                                                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-01 | **Orient myself.** As someone exploring an area, I want to move between country context and street detail so I can understand where a place sits.                           | I open at street scale with house numbers, paths and places visible; I can pan and zoom, switch to Country overview, and return to Podgorica without restarting the app.                                                                                             | Gestures retain their normal map meaning; zooming does not accidentally select a point. Coverage detail varies by area.                                                                                                                   |
| US-02 | **Find a known place.** As someone with a name or street in mind, I want to search the directory so I can locate a matching listing.                                        | Matching results and map markers agree; I can open a result. Supported Latin diacritics and Cyrillic folding do not prevent a match. No matches produces an explanation and a way to change the search.                                                              | Search covers the bundled directory, not every map label or address. It is substring matching, not fuzzy search or reverse geocoding.                                                                                                     |
| US-03 | **Discover something useful nearby.** As someone deciding what to do, I want to filter by need and compare places near the area I am viewing.                               | I can choose Explore all, Eat & drink, See & do, Shops, Stay, or Essentials; moving the map changes nearest-first ordering; Reset clears text/category filters.                                                                                                      | Distances are approximate straight-line distances from the **map center**, not my GPS location or travel distances. The list shows up to 40 nearest matches; the heading counts all matches, including those outside the viewport.        |
| US-04 | **Judge whether a listing fits my need.** As someone considering a place, I want its available details and sources so I can decide what to do next.                         | Selecting a marker or result opens the same details experience with available name, type, address, hours, phone, coordinates, website, and source link. Closing returns me to exploration.                                                                           | Missing fields stay missing. Listings and OSM hours may be incomplete or outdated; they do not establish that a business is open now.                                                                                                     |
| US-05 | **Understand what I tapped.** As someone inspecting the map, I want to identify a building, road, park, water feature, stop, or bare point so I can use the right location. | The card describes available attributes and coordinates. A selected footprint, line, or existing marker is visibly distinguished. A building retains its available address when zoom or label visibility changes.                                                    | No invented names, entrances, addresses, or bridge metadata. Bare points remain coordinates. Selection refers to the actual object rather than an extra, misleading pin.                                                                  |
| US-06 | **Set my journey's endpoints.** As someone planning a trip, I want to use a listing, stop, object, or arbitrary point as From or To.                                        | A/B markers and a text summary agree. I can set either endpoint first, replace one while retaining the other, revisit it, and clear both. Closing details or changing layers keeps the endpoints.                                                                    | Points are session state; reloading clears them. Reset clears search/category/selection, while Clear points clears the journey. My current location is shown but never becomes an endpoint automatically.                                 |
| US-07 | **Compare driving and walking.** As someone with two endpoints, I want a route and travel estimate for my chosen mode so I can judge the trip.                              | With a connection, Car or Walk produces a mapped route, distance/time, and expandable details. Mode or endpoint changes replace the previous calculation. Failure leaves the endpoints available and offers retry.                                                   | Estimates are not live traffic or turn-by-turn navigation. Routes can start/end on nearby accessible roads or paths. Car/walk routing needs a connection and sends endpoint coordinates to the external provider.                         |
| US-08 | **Explore a bus option.** As someone considering public transport, I want a suggested bus-and-walk itinerary so I can identify routes and stops to investigate.             | Public transport can show a direct bus or one-transfer suggestion, boarding/alighting stops, walking links, approximate duration and distance, and route details. Bundled suggestions remain usable after an offline download.                                       | This is a dated pattern-based suggestion, not a current timetable or arrival prediction. Waiting is extra; dotted bus lines are schematic and unrefined walks are approximate. An unsuccessful search explains the network/access limit.  |
| US-09 | **Check bus context.** As someone considering buses in Podgorica, I want stops and optional live positions so I can see reported activity.                                  | Transport shows selectable named stops and route-number bus markers when available. Its status distinguishes loading, checked, delayed, unavailable, paused, and offline states. Turning it off hides stops and clears positions.                                    | Stops are a dated snapshot and work without live vehicles. A feed check is not GPS age. Movement-based direction, route-estimated direction, and unknown direction stay distinct; no bus identity, speed, or ETA is invented.             |
| US-10 | **Inspect the area's physical appearance.** As someone understanding a location, I want to compare street mapping with the available imagery.                               | I can enable the satellite sample, see its coverage/source note, explore it with map context, and return to Street map. Chosen endpoints remain available.                                                                                                           | Imagery is a bounded central Podgorica sample, not country coverage. Enabling it currently moves the camera to the sample and closes the details card.                                                                                    |
| US-11 | **Prepare for losing connectivity.** As someone heading out, I want to save the map and know whether it is ready.                                                           | I see download size and progress, can cancel, and receive a saved/READY state only after verification. Reopening offline still supports map browsing, directory search, details, point selection, stops, and bundled bus suggestions.                                | Browser support, secure hosting, capacity, and possible eviction affect availability. Saving a map does not make live buses or car/walk routing work offline. Live positions and external route responses are never saved in the package. |
| US-12 | **Recover and retain control.** As someone relying on the map, I want failures and updates to preserve usable work and make recovery understandable.                        | Startup/map failures are visible; route failure does not break browsing. Failed/cancelled archive replacements preserve the previous verified download. Incomplete app updates keep the working shell. I can remove a saved archive intentionally.                   | Successful app updates may reload open tabs and reset session routes/selections. Archive safety does not guarantee atomic replacement of every cache asset, permanent browser retention, or preservation after intentional removal.       |
| US-13 | **See where I am.** As someone opening the map, I want my position and its uncertainty shown automatically so I can relate the map to my surroundings.                      | With permission, a marker and accuracy ring appear without a click and the map centers once; Recenter returns to it. Without a fix, the status names the reason (blocked, unavailable, timed out, outside the map) and labels the default view as central Podgorica. | Accuracy is the browser's reported radius; over 50 m is shown as approximate and fixes older than 30 s as not updating. The position is never stored, sent, or used for routing.                                                          |

Detailed behavior remains authoritative in [point selection](../point-selection.md), [routing](../routing.md),
[transport](../transport.md), the [frontend guide](../../apps/web/README.md), and
[app updates](../runbooks/release.md#automatic-app-updates). Source and licensing requirements remain in
[DATA_LICENSE.md](../../DATA_LICENSE.md).

## Success across a complete journey

Judge future changes against completed tasks, not the presence of a particular button. These scenarios connect the
stories and expose regressions between features.

1. **Find somewhere useful:** starting without a selected place, choose a category or search, compare results, open a
   suitable listing, identify it on the map, and inspect its available details/source. Change the query to one with no
   matches, recover through another query or Reset, and select again. Covers US-01–05.
2. **Plan a trip:** use a listing as From and a map point or stop as To, verify A/B, compare Car and Walk, and inspect
   details. Change one endpoint and confirm the old route disappears; recover from provider failure without reselecting
   both points; clear the journey. Covers US-04–07 and US-12.
3. **Evaluate a bus option honestly:** choose two points near the bus network, select Public transport, identify the
   bus, stops, walking legs, and extra waiting. Enable Transport and distinguish live positions from the saved
   stop/pattern information. A feed failure must leave the map and stops useful. Covers US-06, US-08, and US-09.
4. **Leave the connection behind:** download while connected, confirm completion, disconnect and reopen, then search,
   inspect a building address, select endpoints and a stop, and request a bundled bus suggestion. Car/Walk and live
   buses explain their connection requirement. Covers US-02–09 and US-11.
5. **Keep a working installation:** cancel or fail a replacement download; confirm the previous verified archive
   remains. Fail a shell update; confirm the working shell remains. Complete an update on a later load/reload; confirm
   offline reopening still works and document the session reset. Covers US-11–12.

Run the same critical journeys on a phone and desktop. The preservation requirements include accessible names and toggle
states, visible keyboard focus, `/` to focus search, Escape/close behavior, usable scrolling, and touch gestures. These
are requirements to check, not a claim of full accessibility compliance. See [UI guidelines](../engineering/ui.md) and
[testing limitations](../testing.md).

## What success would mean in user research

No user study, completion-rate baseline, or product analytics was collected for this document. The following are
proposed evaluation measures, not measured results or telemetry requirements.

| Outcome                                 | Evidence to collect in an observed task                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Find a relevant place                   | Task completion, time to the correct listing, wrong selections, and whether the person can identify the selected place on the map.                                 |
| Understand proximity                    | Ask what the list's distance is measured from; success is correctly identifying the map center and recognizing it is not a travel distance.                        |
| Make a route decision                   | Ask the person to identify From/To, chosen mode, route estimate, and next step; record endpoint mistakes and recovery effort.                                      |
| Interpret buses correctly               | Ask what is current, what is saved, whether waiting is included, and whether a direction arrow guarantees travel direction.                                        |
| Trust offline preparation appropriately | Reopen without a connection and complete the saved-map tasks; ask which capabilities still require a connection and whether READY guarantees indefinite retention. |
| Recover independently                   | Record whether the person can resolve an empty search, retry a route, cancel a download, and continue after live buses fail without losing the useful map.         |

Choose targets after observing representative users. Download counts, marker counts, or toggle clicks alone do not prove
these outcomes.

## Current UI observations and next questions

These are follow-up candidates, not additional implemented promises or instructions to redesign everything. Prioritize
by task impact after validation.

| Observation from the current UI                                                                                                                                        | User risk / question to validate                                                                                      | Success to preserve or improve                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| The result heading says “nearest first”; row distances do not name their origin.                                                                                       | Do people interpret this as distance from their own location?                                                         | People can explain map-center ordering without assistance. US-03.                               |
| On a 412×840 phone, results are initially collapsed behind the count heading; the category strip scrolls horizontally with Essentials partly outside the initial view. | Can first-time users find the list and discover every category?                                                       | Every category and list-to-map journey is discoverable on a phone. US-02–04.                    |
| Endpoint summaries, route modes, notes, expanded itinerary, download controls, and live-status overlays compete with map space on a phone.                             | Can someone read the itinerary and still identify A/B and the route? Can they select another destination comfortably? | Route editing and geographic context remain usable together. US-06–09.                          |
| “Saved map in use” appears when a verified archive is active, including while the device is connected; the phone hides the storage note.                               | Do people confuse a saved archive with connectivity status or assume every feature now works offline?                 | Saved-map readiness and network-dependent capabilities are understood separately. US-09, US-11. |
| Listing source warnings and transport/route caveats are present, often in small text or disclosures.                                                                   | Do people notice limitations before relying on hours, bus timing, direction, or imagery coverage?                     | People make decisions with the correct uncertainty. US-04, US-08–10.                            |

Before extending scope, validate the main task and context: discovery versus a known destination, visitor versus
frequent local use, intended offline conditions, and the most common failed journeys. Current-position
acquisition/display is now specified in [Discover](discover.md#d-06-current-position-and-honest-uncertainty) as an
unimplemented target. Full address search, saved/shareable trips, departure times, navigation, or listing corrections
need their own research and acceptance criteria; the current UI does not establish those capabilities.

## Evidence and maintenance

The baseline combines the rendered local static-host UI, source inspection, existing product documentation, and
acceptance tests. Visual inspection used desktop 1280×800 and touch-emulated phone 412×840 views. It covered opening,
empty search, results, listing details, endpoint selection, route-provider failure, a real bundled bus suggestion with
approximate walks, transport unavailable state, satellite switching, and a completed download followed by offline
reload. External routing and live vehicle responses were intercepted for these inspection flows; this does not verify
current provider availability, data accuracy, or real-device performance.

Use these existing checks as evidence, while retaining human task evaluation:

| Stories         | Existing verification sources                                                                                                                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-01–06, US-10 | [Map browser journeys](../../apps/web/tests/e2e/map.spec.mjs): search/selection/layers, endpoints, gestures, building addresses, and persistent object highlighting. [Search helpers](../../apps/web/tests/core.test.mjs) cover folding and nearest/category behavior. |
| US-07–08        | [Routing unit checks](../../apps/web/tests/routing.test.mjs) and isolated routing-provider browser journeys cover mode differences, bus itineraries, cancellation/errors, and clearing. Provider fixtures do not prove real-world travel accuracy.                     |
| US-09           | [Transport unit checks](../../apps/web/tests/transport.test.mjs), [direction cases](../../apps/web/tests/vehicle-direction.test.mjs), and browser journeys cover toggles, stale/expiry behavior, stops, failure, and offline behavior.                                 |
| US-13           | [Discover unit checks](../../apps/web/tests/discover.test.mjs) cover location states, thresholds and the accuracy ring; browser journeys emulate granted and blocked location. Emulation does not prove real device fixes.                                             |
| US-11–12        | [Offline transactions](../../apps/web/tests/offline.test.mjs), [worker lifecycle](../../apps/web/tests/service-worker.test.mjs), [update journeys](../../apps/web/tests/e2e/updates.spec.mjs), and real-archive offline browser acceptance.                            |

Automated coverage is partial: for example, browser search uses fixtures and does not establish discoverability,
comprehension, full keyboard/screen-reader usability, or physical-phone behavior. Follow
[the testing guide](../testing.md) for commands and device checks; do not interpret a green suite as user research.

For subsequent changes, name the affected story IDs, describe the user-visible improvement, preserve the relevant
success scenarios and failure states, and update this baseline when the product promise changes. Keep implementation
detail in its owning document and review cross-component work against [ownership](../ownership.md).
