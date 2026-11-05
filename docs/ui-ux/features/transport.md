# Live Podgorica transport

Serves [US-05](../user-stories/user-stories.md), [US-06](../user-stories/user-stories.md), and
[US-09](../user-stories/user-stories.md): let a person inspect a stop, optionally see reported bus activity, and use a
stop as a deliberate journey endpoint without implying live arrival predictions. The separate offline behavior preserves
the stop capability while being honest that live positions require a connection.

## Product behavior

The optional Transport toggle adds blue route-number markers without replacing the map. Each marker points in the bus's
direction of travel (see Direction below). It works with street/satellite views. Updates run every 13 seconds only while
enabled and visible. Switching it off cancels requests and clears positions.

The panel names ePodgorica as the source and displays when the feed was checked. The provider does not expose GPS
timestamps, heading or stable vehicle IDs. Do not label a marker with invented speed, bus identity, or GPS age.
Direction is derived, never reported by the provider, and the marker shows how it was derived. Duplicate
route/coordinate entries are merged.

Offline mode clears positions and explains that live buses require a connection. Failed refreshes mark existing data as
delayed; positions older than 60 seconds are removed. Live data is never placed in offline manifests, Cache Storage, or
OPFS. Offline map/download functionality remains separate.

## Direction

ePodgorica reports only route and position, so direction is derived in this order:

1. **Server movement.** The Go server checks the upstream about every 13–14 s from startup (at most one upstream request
   per cache period, shared with viewer requests, including during an outage) and follows vehicles across its checks and
   adds `bearing` and `heading: "movement"` once a vehicle has moved at least 20 m. Vehicles are matched to the previous
   check by route and nearest plausible position (at most 30 m/s plus 50 m). A vehicle keeps its last direction while it
   stands still. History resets after 60 s without checks.
2. **Page movement.** apps/web/src/vehicle-direction.js applies the same rules to the checks this page has seen. This is
   how mock mode (the relay, which has no bearing) gets directions.
3. **Route estimate.** A bus not yet seen moving points along the nearest stop-to-stop segment of its route in the
   bundled network snapshot (within 2 km). The patterns cover both directions of the same streets, so this is often
   reversed: about 4 in 10 on a live sample of 92 moving buses (2026-11-01). It is drawn as an outlined teardrop with a
   blue label, and the panel explains it.

A bus with no movement and no route within 2 km shows a plain disc without a point. Markers rotate with the map. Solid
blue teardrops are movement-based.

## Hosts

The web app's data mode decides who fetches the feed (see [web data modes](../../../apps/web/README.md#data-modes)). In
server mode it polls the Go server's `api/v1/transport/vehicles`, which fetches the upstream itself. In mock mode
(GitHub Pages, `make dev-mock`) it polls the hosted relay, as before.

## Integration

The source UI is <https://epodgorica.me/javniprevoz/mapa>. Its shipped frontend requests
<https://adminapi.prevoz.podgorica.me/api/dispatcher/vehicles/public> every 13 seconds. A direct GET from the GitHub
origin receives no allowed-origin header; the ePodgorica origin receives its own allow-origin response. Pages cannot
proxy that server-side.

services/backend (`internal/client/epodgorica`, `internal/service/vehicles`) fetches the same fixed upstream with the
relay's limits (8 s timeout, 512000-byte body, non-2xx and non-array rejection, 2000 rows) and serves the same contract,
plus movement directions. It refuses redirects and logs refresh failures (the first, then at most one per minute with a
count) and the recovery. `-live-transport=false` disables it (503, no polling). services/transit-relay implements a
fixed-upstream read-only relay with bounded fetches, duplicate filtering, a brief shared cache, CORS, and explicit
stale/expiry responses. apps/web/src/transport.js validates and renders the published GeoJSON contract. Source details
were inspected on 2026-10-18. No login, cookies, access tokens, or private vehicle endpoints are used upstream.

## Current release status

The hosted relay is public following explicit owner authorization. An anonymous live smoke test returned HTTP 200 and
actual upstream bus positions with public read CORS. A Chromium fetch from <https://ivanov-gv.github.io> also returned
HTTP 200 with 16 positions and stale=false. Desktop/mobile browser tests use deterministic intercepted feed responses;
that is separate from live relay verification.

The GitHub Pages client calls the public hosted endpoint. Deployment runs through the web Actions workflow after merge
to main.

Hosting identity and source version are in [deployment.json](../../../services/transit-relay/deployment.json). The
service implementation and update procedure are in [its README](../../../services/transit-relay/README.md).

## Bus stops

Transport also shows 719 official stops from a reviewed ePodgorica snapshot retrieved 18 October 2026. Hollow blue
circles appear at zoom 13; names appear at zoom 16. Tap a stop for its name, source ID, snapshot date, and From/To
actions. Stops remain visible offline and while live vehicle updates are unavailable; disabling Transport hides both
layers and closes stop details.

The snapshot is data/sources/transport-stops.geojson with its own provenance JSON, source URL, count, byte size, and
SHA-256. It is copied into the web artifact and offline shell; vehicle positions remain excluded. To refresh
deliberately, fetch /api/gtfs/stops/all, preserve stopId/name/longitude/latitude, validate unique IDs and coordinates,
update provenance/date UI, and run make check plus browser acceptance. This refresh does not require rebuilding the
basemap archive. Stop details do not imply live arrival predictions.

The Transport panel keeps live status visible and puts its source/snapshot explanation under Source and details, leaving
room to select route endpoints on smaller screens.
