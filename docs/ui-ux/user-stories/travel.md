# Travel: follow the route with live position

Status: target product requirements, agreed direction on 3 November 2026; **not a claim of implemented navigation**.
Travel completes **Discover → Understand → Plan → Travel**. [Plan](plan.md) chooses how to get there; Travel relates the
person's changing GPS/device position to that chosen route while they move.

This is a target user story, not a maintained capability in the [current story baseline](user-stories.md): the product
can show current position and a calculated route, but it does not yet implement a Travel lifecycle, progress, deviation
recovery, or arrival. Do not treat its requirements as a justification for claiming those features exist.

## Purpose, stories, and success

**As someone ready to travel, I want to see my live position against the selected route and understand my progress, so I
can follow the path, recognize when I need to recover, and reach the intended destination.**

| Requirement / story      | Observable success                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| T-01 Start deliberately  | I start following a clearly identified selected route, with its mode, destination and limitations retained from Plan.                   |
| T-02 Know my position    | My marker updates from usable device fixes, with honest accuracy, age and unavailable states.                                           |
| T-03 Follow on the map   | Position and route remain visible together; I can inspect the surroundings and return to following without losing the trip.             |
| T-04 Understand progress | I can identify the current supported leg/segment, remaining path and next relevant action without invented precision.                   |
| T-05 Recover             | I can distinguish uncertainty from a genuine departure from the route, then return to Plan or deliberately request a replacement.       |
| T-06 Handle interruption | GPS loss, connectivity loss or app interruption has an explicit effect; stale data never pretends that movement is still being tracked. |
| T-07 Finish or stop      | I can recognize the destination context, confirm completion or stop early, ending Travel behavior without creating a location history.  |

**MUST** denotes required behavior; **SHOULD** denotes a recommended design with a documented reason for alternatives.
Here **tracking means live position and route-progress processing in the active session**. It does not mean recording,
saving, uploading or sharing a breadcrumb trail. Voice guidance, background navigation and automatic rerouting are not
required by this initial Travel story.

## T-01 Start from a chosen plan

Travel MUST start through an explicit action on a valid selected plan. Merely viewing a route, selecting an object or
receiving a GPS fix must not start it. Preserve the chosen destination, mode, route identity, legs, actual start/end
points, snapped-point differences and any unresolved limitations from Plan. A provisional bus suggestion must not become
a verified operating service because tracking started; critical feasibility gaps remain subject to Plan's readiness
criteria.

With no usable route, direct the person back to Plan. With a route but no usable position, retain the route and show
acquisition/recovery or manual inspection; do not call that live route-following. Starting away from the planned origin
must not invent a connecting path. Explain the mismatch and offer explicit replanning or inspection.

## T-02 Live GPS/device position and uncertainty

Reuse [Discover's location semantics](discover.md#d-06-current-position-and-honest-uncertainty): permission, secure
hosting, reported coordinates, accuracy and fix age. The browser's position can come from GPS or other device/provider
sources; it must not be labeled survey-precise GPS merely because the API returned a coordinate.

The [W3C Geolocation specification](https://www.w3.org/TR/2026/CRD-geolocation-20261030/) describes repeated position
updates, accuracy/time information, permissions and clearing a watch. It also conditions updates on document visibility
and activity. **Product consequence:** a browser tab is not a promise of continuous navigation with the screen locked or
the app in the background. Foreground route-following is this story's scope; validate actual device behavior.

| Position condition                               | Required Travel behavior                                                                                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usable, recent fix                               | Update the true position marker and ground-scaled uncertainty; update route progress only when the association is credible.                                                            |
| Approximate or ambiguous                         | Keep the uncertainty visible and qualify route association. Do not assert the exact road, side, bridge level, stop or entrance.                                                        |
| Stale, lost or timed out                         | Distinguish the last known fix, show that updates are unavailable, and suspend position-derived progress, off-route decisions and arrival detection. Keep route/manual context usable. |
| Permission denied/revoked or service unavailable | Explain recovery at the location action, without repeated prompt loops or a fabricated moving marker.                                                                                  |
| Return after hidden/suspended state              | Recheck fix age and route validity; obtain usable updates before resuming progress. Never interpolate an unobserved journey as if it were tracked.                                     |

Keep raw location distinguishable from any matched route position. If matching or smoothing is used, it MUST NOT hide a
material discrepancy or replace the accuracy circle with false certainty. Derive heading only from valid supported
information; a stationary or uncertain fix must not invent a direction arrow.

Travel needs mode-specific freshness and accuracy validation. Discover's display thresholds are not automatically
sufficient for car guidance or a close turn. Do not promise a fixed update rate, always-available heading, indoor
positioning, or road-level precision without supporting device evidence.

## T-03 Follow mode and map inspection

During live following, the map MUST keep the position, selected route and useful upcoming context visible together.
Preserve recognizable A/B/destination and uncertainty without covering the path with controls. The chosen view and
travel mode remain separate, as defined in Plan; imagery or transport-layer changes must not silently change the route.

Allow the person to pan/zoom and inspect the route. Manual exploration SHOULD suspend camera following, while position
and progress continue when fixes are usable. Make that state distinguishable and provide an immediate recenter/resume
follow action. Do not repeatedly pull the camera back during deliberate inspection. Suspending camera follow is not the
same as pausing Travel or disabling location.

Use the [interface target](../features/interface.md) for stable controls, accessible state and concise action-specific
messages. Following may need a focused travel presentation, but it must retain a usable map, clear stop/return actions
and a consistent location control. Use one map instance. Voice, vibration and continuous heading-up camera rotation
require separate design and capability decisions; none is necessary to establish this core story.

## T-04 Progress against the selected route

The person MUST be able to see where they are relative to the route, which supported leg is current, and what remains.
Distinguish completed/current/remaining portions where the data supports reliable progress. Remaining path distance is
distance along the selected route from the credible current segment, not a straight line to the destination.

Matching must consider the sequence of recent fixes, route continuity and uncertainty. Nearest geometry alone must not
jump progress between a parallel road, bridge/underpass, repeated loop or intersecting route segment. Treat an ambiguous
segment as uncertain rather than falsely advancing. Genuine backtracking may increase remaining distance; do not force
monotonic progress to conceal it.

| Mode             | Useful Travel context                                                                                       | Limit to preserve                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Walk             | Current mapped leg, next supported path/turn/landmark and remaining walking path.                           | Do not invent an entrance approach, step-free access or a safe crossing from a line or uncertain fix.                                                                                                          |
| Car              | Current supported road segment and next available maneuver from the chosen itinerary.                       | Do not infer traffic-aware arrival, lane guidance or a new accessible destination connection.                                                                                                                  |
| Public transport | Access walk, boarding stop/route/direction, stop sequence, transfer/alighting and egress walk as supported. | Schematic bus lines are not street geometry. GPS near a stop does not establish boarding, vehicle identity or actual service. Allow deliberate leg confirmation when position cannot establish the transition. |

Next-action text MUST come from supported itinerary/leg data. A timer or a live bus dot must not advance the person's
journey automatically. Schematic or approximate legs must remain visually distinct and cannot be treated as precise
paths for turn guidance or off-route matching.

If showing remaining time or arrival, identify it as an estimate and retain the calculation's limitations. A planned
duration is not a live ETA. Missing bus waits/departures or uncertain progress must not become a precise arrival time.
Readable route, position and progress are required; unsupported turn-by-turn claims are not.

## T-05 Off-route behavior and replanning

Off-route detection MUST account for reported uncertainty, repeated evidence, mode and geometry quality. A noisy fix or
a schematic bus chord alone must not trigger an alarm or replacement. When association is unclear, say that progress
cannot be determined. When a departure is credible, distinguish it clearly and offer inspection or return to Plan.

The initial requirement is **explicit replanning**, not automatic rerouting. A deliberate request may use a current
usable fix as the new origin, retaining destination and intended mode. Explain when that sends selected coordinates to
the routing provider. Keep the old route identifiable while a replacement is pending; do not label it current guidance
for the new request. Only adopt a valid replacement for the latest request, visibly, and reject late results after
another edit, Stop or Finish. Failure preserves useful map/context and an editable request.

Automatic rerouting would need a separate choice and specification for permission, provider limits, origin selection,
request frequency and result adoption. It is not implied by live tracking. No off-route action may invent an access
connector or silently change the destination/mode.

## T-06 Connectivity, interruption, and privacy

| Situation                                                  | Required expectation                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection lost during an active session                   | A still-valid route already in session memory may remain available for following with usable device fixes and saved map coverage. Mark online-dependent functions unavailable; this is a target, not current behavior. |
| New route/replanning while offline                         | Preserve the [Plan offline boundaries](plan.md#p-07-revision-recovery-and-offline-boundaries): no current offline car/walk engine; bundled bus suggestions remain dated/approximate.                                   |
| Position lost but map available                            | Keep the route available for inspection while live progress is suspended; connectivity and positioning are separate states.                                                                                            |
| Reload, worker update, tab termination or browser eviction | Do not claim uninterrupted Travel or automatically reconstruct movement. Current routes are session-only; explain interruption/replanning rather than pretending a route or history was persisted.                     |
| Background or locked screen                                | No continuous-tracking guarantee. On return, revalidate position and state before reporting live progress.                                                                                                             |

External route responses, live positions and travel history MUST NOT enter offline packages, Cache Storage, persistent
storage, analytics or application logs. Minimal recent fixes needed for matching stay in session memory and are
discarded when no longer needed; no recorded track, sharing service or user account is introduced. Replanning is a
separate coordinate transmission, not continuous uploading of the person's path. Browser/OS positioning providers may
use their own services, as explained in Discover.

Stopping Travel MUST end route-progress processing, camera follow and any Travel-only location subscription. If the
shared Discover location capability remains active, communicate that distinction; do not claim all positioning is off.
Do not create a second independent GPS watcher just to support Travel or leave Travel work running after exit.

## T-07 Arrival, completion, and stopping

Approaching the destination MUST show its actual context: selected place, routed endpoint, and any known final
entrance/access gap. Proximity to a snapped road endpoint is not proof of entering the intended building or reaching a
particular floor. Poor accuracy or one noisy fix must not complete the journey.

Offer a clear near-destination state and deliberate **Finish** action. Any automatic arrival suggestion needs credible
route/location evidence and must allow correction; it does not certify physical access. A person can **Stop** early
without claiming arrival, retain the map for exploration, or deliberately return to Plan. Finish/Stop cannot erase a
verified offline map or create a saved trip/history. Subsequent position callbacks or late route responses must not
restart the ended journey.

**User success:** the person can follow the chosen path with a truthful position/progress display, recognize and recover
from uncertainty/deviation, identify the intended destination, and finish intentionally. A moving dot alone is not proof
of route-following; reaching an inaccurate marker is not proof of arrival. An interrupted or abandoned journey is an
honest outcome, not a completed trip.

## Current capabilities and implementation gaps

Audit of the reviewed repository on 3 November 2026:

| Area            | Current evidence                                                                                                                                                                                           | Work still required                                                                                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device position | [Position tracker/layers](../../../apps/web/src/position.js) provide repeated fixes, accuracy and state for Discover. [App rendering](../../../apps/web/src/app.js) centers once and provides recentering. | No Travel lifecycle, ongoing follow camera, route association, progress or arrival. Existing location support is not complete navigation.                                                                |
| Chosen route    | [Route planner](../../../apps/web/src/route-planner.js) draws the calculated route and itinerary from Plan.                                                                                                | No current-position matching, active-leg tracking or off-route recovery. Car/walk lines are currently invalidated on going offline; continued session following would require deliberate implementation. |
| Handoff and end | [Plan](plan.md) specifies readiness and a deliberate Travel transition.                                                                                                                                    | Start/Stop/Finish, interruption handling, replacement adoption and matching/arrival policies are target behavior. Voice/background/automatic-rerouting features remain separately scoped.                |

Web owns the active-session state, shared location lifecycle, matching/progress and presentation. Data owns geometry,
leg/stop/entrance evidence and provenance; [contracts](../../../packages/contracts/README.md) own published shared
formats. Follow [ownership](../../system-architecture/ownership.md) and validate producers/consumers together for any
added semantics. No new backend, tracking API, navigation provider or persistent route store is assumed. This change
documents the story only.

## Acceptance and user-success evidence

| ID    | Scenario                                                                                                          | Pass condition                                                                                                                                               |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TA-01 | Inspect a plan, then deliberately start with a usable route/fix; repeat without either.                           | No incidental start; valid chosen route retained; missing route/fix has an honest acquisition/recovery state rather than fake live following.                |
| TA-02 | Move through timestamped fixes along a mapped route.                                                              | True position/uncertainty update with credible segment/leg and remaining path; no fixed-rate or precision claim beyond the supplied evidence.                |
| TA-03 | Supply stale/noisy fixes, jumps, parallel roads, a bridge crossing, a loop and real backtracking.                 | No false segment jump, off-route alarm or arrival; ambiguity suspends precise progress; genuine reverse movement is not concealed.                           |
| TA-04 | Pan/zoom, inspect another area, resume following and change a context view.                                       | Tracking continues when usable; camera does not fight inspection; route/mode/destination stay unchanged and resume is explicit.                              |
| TA-05 | Travel a walk/drive itinerary and a schematic bus suggestion.                                                     | Supported next-leg context; no invented turn/access/traffic/departure/boarding claims and no precise bus-chord matching.                                     |
| TA-06 | Leave the route credibly; request/fail/replace a route, then deliver a late response.                             | Explicit replanning, preserved destination/mode, honest pending/failure, latest valid replacement only; Stop prevents adoption.                              |
| TA-07 | Lose/revoke location and recover.                                                                                 | Last-known state is distinct; no invented movement/progress; recovery revalidates the fix before resuming.                                                   |
| TA-08 | Lose connection, hide/lock the app, return, then reload.                                                          | Active in-memory following only where supported; limitations and interruption are explicit; no persisted external route or fabricated background track.      |
| TA-09 | Approach a snapped endpoint or uncertain destination, Finish, and Stop early.                                     | Destination/access context remains clear; no automatic completion from one bad fix; deliberate end stops Travel work and never labels early Stop as arrival. |
| TA-10 | Repeat on desktop, 412×840 phone, keyboard, reduced motion and physical devices; inspect storage/network effects. | Route and position readable together, controls usable, no unsolicited trace upload/history, and no Travel callbacks restarting work after exit.              |

Implementation needs deterministic fix/route fixtures plus physical-device tests for accuracy, update behavior,
suspension and recovery. In observed tasks, measure whether people can identify their position/uncertainty, explain the
next supported leg, detect a real deviation, regain the route, and finish or stop deliberately. Source adequacy,
matching correctness, usability and comprehension are separate verdicts. No user-study or device-performance baseline is
asserted; use [testing](../../verification/testing.md) for verification scope and commands.
