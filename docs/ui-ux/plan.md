# Plan: choose how to get there

Status: target product requirements, agreed direction on 3 November 2026; **not a claim of completed implementation**.
Plan is the third stage of **Discover → Understand → Plan → Travel**. After learning enough about a place, the person
deliberately asks how to reach it. Existing routing capabilities are documented in [routing](../routing.md); this
document defines the intended experience and user success.

## Purpose, stories, and success

**As someone who knows where I want to go, I want to choose my starting point, inspect useful map views, and compare
ways to travel, so I can select the most relevant available path and be ready to navigate.**

| Requirement / story               | Observable success                                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-01 Enter planning intentionally | I can move from exploration or object details into a clear planning state, without ordinary inspection starting a trip.                                                      |
| P-02 Choose useful context        | I can use the default map, Transport or Satellite as appropriate, retaining my endpoints and route choice. Future views can extend this context without redefining the trip. |
| P-03 Set From and To              | I can identify, set and change each endpoint independently, including a deliberately selected location or mapped entrance when supported.                                    |
| P-04 Calculate by mode            | With both endpoints chosen, I can request a Walk, Public transport or Car route and understand calculation, result and failure states.                                       |
| P-05 Find the most relevant path  | I can compare the supported options using their travel burden, endpoint access and known limitations, and select the one that fits my intention.                             |
| P-06 Be ready to navigate         | I know the selected path, mode, starting action, destination and important remaining checks; I can intentionally proceed to Travel.                                          |
| P-07 Revise or recover            | I can change my mind, recover from a failed calculation or return to exploration without losing useful endpoint/context state.                                               |

**MUST** denotes required behavior; **SHOULD** denotes a recommended design with a documented reason for alternatives.
“Available” means supported by actual data and providers. It must not imply that every real-world route, transport
service, departure, map view or accessibility condition is known.

## P-01 A deliberate stage transition

Planning begins with an explicit intention to organize a journey: entering the planner, choosing a selected place as
From/To, or an equivalent clear route action. Opening a building/POI, reading hours, or clicking a bare point remains
[Understand](understand.md) and MUST NOT automatically change endpoints or request routes.

The stages describe intent rather than a mandatory wizard. Someone who already knows the destination can enter Plan
directly; there is no requirement to open every detail first. The person may return to Understand when an entrance,
address or stop is still unclear, then resume the same plan.

Unlike the one-selection detail rule, Plan may need additional clicks, an expanded planning workspace, view changes,
asynchronous calculations and waiting. Each step MUST advance a recognizable task: choosing context, endpoints, mode, or
an option. It must remain clear which stage/action the person is in and how to return.

Control placement follows the [interface target](interface.md): stable shared header, deliberate dock expansion, minimal
wording, accessible state, and usable map space on phones. Do not silently replace the approved dock with nested menus
or a bottom sheet. The eventual planning composition needs its own layout acceptance within those constraints; this
document does not prescribe a second application or a new map instance.

## P-02 Map views and travel modes are separate choices

A **view** changes the geographic context being inspected. A **travel mode** changes the movement network and route
calculation. Selecting Transport MUST NOT silently choose Public transport as the routing mode; selecting Public
transport MUST NOT require enabling live buses. Satellite imagery does not select a mode or establish a route.

| View / context          | Planning purpose                                                                | Capability boundary                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default map             | Read streets, paths, buildings, addresses and geographic relationships.         | Core context from [Discover](discover.md); visible geography alone is not a routable graph.                                                                                                  |
| Transport               | Inspect relevant stops, transport context and optional reported live positions. | Existing stop/vehicle layers are distinct from itinerary calculation and departure information.                                                                                              |
| Satellite               | Inspect the available imagery around a location.                                | Current imagery is a bounded central Podgorica sample; it does not establish access rights, entrances, road connectivity or countrywide coverage.                                            |
| Street panoramas        | Potentially inspect street-level appearance and orientation before travel.      | Future candidate, not an implemented view or a committed provider. Coverage, date, rights, privacy and offline behavior need a separate definition.                                          |
| Detailed topology map   | Potentially inspect more precise spatial relationships and connections.         | Future candidate requiring its own geometry, coverage and accuracy criteria. Network topology and terrain/topography are distinct; elevation claims need ground data, not just connectivity. |
| Intercity transport map | Potentially inspect connections between settlements and relevant services.      | Future candidate; current Podgorica patterns do not establish an intercity network, timetable, fares or current service.                                                                     |

The last three rows preserve possible future directions, not working controls to expose now. A new view MUST have
defined purpose, coverage, availability, licensing and offline behavior before being offered as usable.

Switching context is optional: a person who already has enough information may build a route in the default map.
Compatible layers may coexist; the product must not invent an exclusive-view restriction merely because the controls are
called views. Use the interface's existing layer tiles/toggles, including returning from Satellite by disabling it; do
not add a redundant Standard map control.

A presentation-only change MUST preserve From/To, chosen travel mode, latest valid calculation and selected candidate.
It MUST NOT trigger another route request merely because imagery or transport visibility changed. Keep the route and
endpoints legible in supported geographic views. If a future view cannot show the route overlay, retain an accessible
summary and a clear return to its map overview. An unavailable or out-of-coverage view needs an honest state and a
usable fallback without discarding the trip. Optional layer failures must not break routing or core map use.

## P-03 From and To are explicit geographic commitments

The person MUST be able to choose either endpoint first, distinguish A/From from B/To on the map and in text, replace
one while preserving the other, and clear the journey. Show which endpoint is still missing; no calculation should
appear to be a complete route before both exist.

| Endpoint source                      | Required interpretation                                                                                                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Building, POI, stop or mapped object | Copy the selected subject's identity and coordinates with their known meaning. If an entrance is available and chosen, identify it as that entrance rather than the building center.                              |
| Arbitrary map point                  | Retain the deliberately selected coordinate. A nearby address is context, not permission to relocate the endpoint.                                                                                                |
| Current position                     | Use a usable fix only through an explicit origin/destination choice, showing uncertainty or staleness where relevant. Without a usable fix, offer recovery or manual selection; do not substitute the map center. |

Known entrances and access relationships can help the person choose an appropriate endpoint; they do not authorize a
guessed entrance or a straight connector through a wall, river or private area. The selected destination and the
provider's route endpoint MUST remain distinguishable when snapping moves the route onto a nearby road/path.

The view MUST make endpoint changes clear. Changing either endpoint invalidates the old result for the new pair
immediately. Panning, changing map context, opening details or receiving another location fix MUST NOT silently move the
chosen endpoint. A chosen current-position fix is a planning snapshot; automatically tracking a moving origin or
rerouting during movement is governed by [Travel](travel.md), including the limits on automatic replanning.

## P-04 Calculate and await a route

With both endpoints set, expose **Walk**, **Public transport**, and **Car**. The chosen mode MUST be visible.
Calculation may start after an explicit Build action or automatically after a deliberate planning edit with a clearly
selected mode; an extra confirmation click is not mandatory. A hidden mode default must not surprise the person with a
request unrelated to their intention.

| Mode             | Expected answer                                                                                                    | Limits that must remain visible when relevant                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Walk             | A path through the supported pedestrian network, with distance, estimated duration and readable itinerary.         | A mapped footpath is not proof of current access, step-free travel or safe conditions. Snapped endpoint gaps and unsupported constraints need explanation. |
| Public transport | A bus-and-walk itinerary identifying boarding/alighting stops, route/direction, transfers and access/egress walks. | State source date, approximation and missing schedule information. A pattern-based suggestion is not a verified departure or arrival prediction.           |
| Car              | A route through the supported driving network, with distance, estimated duration and readable itinerary.           | An estimate without live traffic is not a traffic-aware arrival time; the last accessible road may differ from the exact destination/entrance.             |

Support coherent states: **missing endpoints → calculating → result**, or an explicit no-route, unavailable, offline,
timeout or invalid-input state. Loading must be visible and accessible at the route action/status, without blocking map
inspection. Do not display a previous route as the answer to a new pair/mode while work is pending.

Endpoint/mode changes and clearing MUST cancel or invalidate previous work. A late response cannot overwrite the latest
intention or restore a cleared line. Clear removes the route and endpoints; a failed calculation preserves the chosen
points and mode so retry does not require rebuilding the request. Do not turn a no-route result into a straight line
that looks navigable. The same-point case and an endpoint outside supported service/network coverage must be explained
rather than silently moved to a convenient place.

This target does not require querying every mode concurrently or repeatedly polling providers. Schedule requests
deliberately, respect actual provider limits, and reuse valid session results only for matching inputs. Online road/walk
requests send selected coordinates to the configured external provider; this must be understandable at the planning
action. Discover/Understand interactions alone do not authorize those requests.

## P-05 What makes a path relevant

**Most relevant** means the best fit among supported, credible options for the person's expressed intention and known
constraints. It does not automatically mean shortest distance, fastest provider estimate, or the first route returned.
There is no claim of a globally optimal path over unknown roads, missing transport schedules or unmodeled preferences.

| Decision factor      | Information needed to judge it                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mode and feasibility | Whether the option uses the intended mode/network; known access restrictions and unsupported requirements. Do not label a route wheelchair-accessible or stair-free without supporting data and routing capability.   |
| Travel burden        | Distance and estimated time; for transport, walking effort, boardings/transfers and waiting information or its explicit absence. Do not compare a no-wait bus duration with a complete journey time as if equivalent. |
| Endpoint access      | Where the route actually begins/ends, known entrance/stop context, snapping differences, and any unresolved first/last segment.                                                                                       |
| Fit to preferences   | Explain supported trade-offs, such as walking distance or transfers. Only offer preference controls that the engine can honor; unsupported preferences remain a capability gap.                                       |
| Reliability          | Data/source age, provider coverage, approximate versus mapped legs, known missing departures/traffic/access information, and relevant connectivity requirements.                                                      |

The person MUST be able to compare available mode results for the same endpoints and identify the selected mode/path.
When several valid candidates are supported, show their material differences and allow deliberate selection; when only
one is available, say so rather than fabricating alternatives. Multiple same-mode alternatives and preference-aware
ranking need evidence and are not claimed as current capabilities.

Explain the basis of any recommendation or ranking. The current provider result or a local bus-search score must not be
relabeled “fastest,” “best,” “least walking,” or “earliest arrival” unless that claim is actually supported. Preserve
the person's choice across view changes; never substitute another candidate invisibly.

## P-06 Success: a relevant path found, ready to navigate

Plan succeeds when the person can identify all of the following:

1. The intended From and To, including actual route start/end and material access gaps.
2. The selected mode and path, and why it fits the available choices and their intention.
3. Its distance, estimated travel burden and readable sequence of legs/actions; for transport, stops, direction,
   transfers and walking segments.
4. The first action to take and the intended destination/arrival context.
5. Important assumptions, unavailable information and any remaining check required before proceeding.

The result should distinguish three outcomes:

| Outcome                | Meaning                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ready for Travel       | A valid selected path matches the current request; the person can explain how to start and has no unresolved critical feasibility check for the intended journey. Estimates and known caveats remain visible. |
| Provisional suggestion | A useful candidate exists, but a critical item such as an actual departure, access connection or endpoint approach still needs checking. Explain the specific next check; do not imply immediate readiness.   |
| No usable plan         | No route, unsupported coverage/mode, missing data or calculation failure prevents a credible answer. Offer a relevant edit/retry path without claiming success.                                               |

An engine's technical “ready” result is not enough to establish user readiness. Current dated bus patterns can supply
useful suggestions, but not confirm that a bus runs now; a time-dependent journey may remain provisional until
departures are checked. A drawn line with an unexplained snapped endpoint also does not prove arrival at the intended
place. Displaying uncertainty must help the person decide what to do next, rather than burying a critical gap in a
generic disclaimer.

**Ready to navigate is the exit condition of Plan, not navigation already running.** Any start-navigation action must be
a separate, deliberate handoff to Travel. It must not begin merely because a calculation finishes, a result is selected
or a map view changes. [Travel](travel.md) now specifies live position against the chosen route, progress, recovery and
completion as target behavior. It does not claim implemented navigation or require voice, background tracking or
automatic rerouting.

## P-07 Revision, recovery, and offline boundaries

Changing views, editing points, comparing modes and revisiting object details MUST retain useful state while clearly
invalidating results whose inputs changed. Closing a planning workspace returns to usable exploration; hiding the
workspace is distinct from Clear. A route-provider or optional-view failure must not break the basemap, selected points,
object inspection, or a verified offline download.

| Capability offline                                       | Required expectation                                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Saved geographic context, points and object details      | Remain usable within the verified package's actual coverage and contents. Device positioning still depends on permission and obtaining a fix. |
| Bundled bus patterns                                     | Can yield dated suggestions with clearly approximate unrefined walks and waiting/departure limitations.                                       |
| Car/walk calculation                                     | Currently requires a connection. Show that condition and preserve the request for retry; a saved map is not an offline routing engine.        |
| Live buses, external panoramas or future online services | Do not claim offline availability without actual local assets, rights and capability. Live positions are not stored offline.                  |

External route responses MUST NOT be put in offline packages, Cache Storage or persistent route history. Session-only
results do not establish persistent offline navigation, and a connectivity transition must not make an unusable result
appear current. Respect existing archive/cache invariants. Reload currently clears session selections/routes; neither
saved trips nor cross-device restoration is introduced by this target.

## Current implementation, gaps, and ownership

This audit describes the reviewed repository on 3 November 2026. The [routing guide](../routing.md),
[transport guide](../transport.md), and [frontend guide](../../apps/web/README.md) remain authoritative for implemented
behavior and provider limits; this document does not refresh data or verify live provider availability.

| Area           | Current evidence                                                                                                                                               | Target gap / constraint                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planning state | [App endpoint state](../../apps/web/src/app.js) and [point selection](../point-selection.md) provide From/To, A/B, replacement and clearing in the current UI. | Dedicated stage/workspace composition must fit the new interface target. Do not claim a new planner layout has shipped.                                     |
| Views          | Satellite and Transport toggle on the existing map; enabling them currently moves the camera to their coverage.                                                | Preserve meaningful route composition through view changes; future panorama, topology and intercity views are unimplemented. Satellite is a bounded sample. |
| Car/walk       | [Road router](../../apps/web/src/routing.js) uses distinct external profiles and accepts one provider route, with validation/cancellation and session caching. | No current multi-alternative or user-preference ranking, live traffic, offline road graph or guarantee of exact endpoint access.                            |
| Transport      | [Local transit search](../../apps/web/src/transit-routing.js) uses representative patterns with up to one transfer and approximate/refined walks.              | No current timetable, waiting prediction, earliest-arrival planner or intercity guarantee. Mode comparison must retain those limits.                        |
| Results        | [Route planner](../../apps/web/src/route-planner.js) draws a line, time/distance and itinerary and invalidates changed work.                                   | Technical result readiness does not implement the full relevance, provisional-status and Travel handoff criteria above.                                     |

Web owns planning state, UI composition, provider consumption and legible results. Data owns reviewed patterns,
geography, access/entrance evidence and provenance. [Contracts](../../packages/contracts/README.md) own published
producer/consumer formats; new semantics need validation and consumer tests together. Follow
[ownership](../ownership.md). No new backend, routing service, panorama provider or transport timetable is invented by
documenting these needs.

## Acceptance and user-success evidence

These are target scenarios; current tests cover only the behavior they actually exercise.

| ID    | Scenario                                                                                                       | Pass condition                                                                                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PA-01 | Open/close object details, then explicitly enter planning.                                                     | Inspection causes no route request or endpoint mutation. The deliberate planning action reveals an understandable next step without forcing a full Discover/Understand checklist. |
| PA-02 | Switch default map, Transport and Satellite before/after calculation.                                          | Endpoints, mode and selected valid result survive. View-only changes do not recalculate; route/summary stays legible and optional-view failures preserve the trip.                |
| PA-03 | Choose Public transport with live buses off; choose Car while viewing transport context.                       | View and mode remain independent; calculation uses the chosen mode, not an inferred mode from the visible layer.                                                                  |
| PA-04 | Inspect a future or out-of-coverage view.                                                                      | No false working panorama/topology/intercity capability; actual availability and fallback are clear without losing endpoints.                                                     |
| PA-05 | Choose either endpoint first, edit one, use a point/known entrance, and test unavailable position or snapping. | Correct subject/coordinate and A/B summary; honest missing/fix/access states; no silent endpoint relocation or automatic moving-origin tracking.                                  |
| PA-06 | Calculate Walk, Public transport and Car for the same pair where supported.                                    | Mode-appropriate geometry, distance/time and itinerary; clear pending/result/unavailable states; unsupported modes do not fabricate an answer.                                    |
| PA-07 | Change mode/endpoint during calculation, clear, and deliver old responses late.                                | Invalid routes disappear or are clearly invalidated immediately; only the latest request can become selected/ready; cleared state stays clear.                                    |
| PA-08 | Test identical endpoints, no route, provider failure, timeout and coverage gaps.                               | Specific recovery guidance, retained editable request and no fake straight-line route; browsing remains usable.                                                                   |
| PA-09 | Compare candidates with different walking/transfer burden and missing bus waiting times.                       | Person can identify the trade-offs and selected path. No unsupported “fastest/best” claim or comparison of incomplete time as complete journey duration.                          |
| PA-10 | Inspect a dated bus suggestion and a route with an unresolved endpoint approach.                               | Required checks are visible; these results remain provisional when critical information is unresolved, rather than being presented as fully ready.                                |
| PA-11 | Reopen a saved map offline, plan with bundled buses and request Car/Walk.                                      | Available geographic/pattern context works; online calculation limits are explicit; no live positions or external route responses are persisted to simulate offline navigation.   |
| PA-12 | Review the chosen plan on desktop, 412×840 phone, keyboard and physical devices; close/resume or proceed.      | Inputs, map, result and itinerary remain usable with the stable interface. User can explain the first action and consciously hand off to Travel; no automatic navigation starts.  |

In observed tasks, ask the person to plan between understood places, choose a context view when helpful, compare modes,
explain the selected path and identify its first action and remaining uncertainties. Record completion, endpoint/mode
mistakes, recovery effort, misunderstood waiting/access gaps and whether the chosen option matches the stated need. An
appropriate outcome may be a provisional suggestion or an honest no-plan result; neither counts as the full success of
**a relevant path found and ready to navigate**. No user-study baseline or new performance target is asserted here.

Implementation plans must name affected P-/PA- requirements, source/provider assumptions and evidence. Follow
[testing](../testing.md) for commands and device limitations; source adequacy, route correctness, usability and user
comprehension need separate validation. This change defines the target only and does not calculate routes or implement a
new view.
