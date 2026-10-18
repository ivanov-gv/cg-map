# Route planning

Pick From and To on the map or a place card. Once both are selected, choose Car, Public transport, or Walk. The selected route is drawn on the existing map with distance/time and expandable route details. Changing either endpoint or mode cancels/invalidates previous work immediately; Clear points also removes the line. Route errors do not affect the basemap or saved endpoints.

## Car and walking

Both use the FOSSGIS public OSRM service, with separate routed-car and routed-foot profiles (the API path says driving for both; the server instance determines the actual profile). These are road/footpath routes, not straight lines. Durations are estimates; driving has no live traffic. Endpoints are snapped to a nearby accessible road/path with bounded search radii. The route may begin/end there instead of at the exact selected coordinate. Results are validated, briefly cached in session memory, cancellable, and timed out after 20 seconds. Requests are serialized and spaced at least 1.1 seconds apart within the client, including transit walking legs. Do not use this public service for heavy/production-scale traffic; a self-hosted or contracted routing backend is the growth path.

Coordinates are sent to routing.openstreetmap.de when requesting road/foot routes; the operator logs route requests. The UI retains attribution and provider/fix-map links. Provider policy: https://routing.openstreetmap.de/about.html . Offline car/walking routing is not available; saved map browsing and endpoint selection still work. External route responses are not stored in offline packages.

## Public transport suggestions

The city download at https://podgorica.me/wp-content/uploads/2026/04/GTFS-v1.zip declares an end date of 2026-06-15, so it is deliberately not used as a current timetable.

Instead, data/tools/import-transit.py fetches current public ePodgorica routes, trips by route/day, stops by trip, and stop coordinates. It samples distinct direction/headsign/stop-count combinations from Monday, Saturday, and Sunday. Duplicate stop sequences are coalesced. This captures representative route patterns, not every branch, departure, holiday, or service calendar. The snapshot is independently dated, hashed, and structurally validated.

The browser scans up to two bus boardings (direct or one transfer), using forward stop order. Access/egress walks are initially limited to an estimated 1 km, transfers to 250 m; nearest access candidates are bounded. Approximate walks use geographic distance with a 1.3 detour factor and 1.3 m/s speed. A five-minute boarding penalty is used to prefer fewer boardings in search, not presented as a predicted wait. Riding durations are estimated from relative times of representative API trips. When online, chosen walking legs are refined through the foot router where possible. Failed/offline refinements remain explicitly approximate.

The displayed transit duration excludes waiting. The UI says to check departures. It is not a leave-now earliest-arrival planner, and live bus dots are not used to invent arrival predictions. Dotted bus lines connect stops schematically; they do not claim exact street geometry. Actual refined walking legs are solid; estimated links are dotted. Offline bus suggestions work after downloading the map, using the bundled patterns.

## Refresh and ownership

Run `python data/tools/import-transit.py` from the repository root for a deliberate route-pattern refresh. The importer reuses individual request results for at most one hour to permit resuming an interrupted import; remove .build/transit-import to force every request to refresh. Published network/provenance files belong to data/sources and are copied unchanged into dist/web and the offline shell. The geography archive is unchanged. See [contracts](../packages/contracts/README.md) and [source provenance](../data/PROVENANCE.md).

routing.js owns validated car/foot requests and request spacing; transit-routing.js owns the pure bounded bus search; route-planner.js owns mode state, cancellation, map line layers and itinerary DOM. app.js passes copied endpoints to this controller. No new backend deployment is required. Browser tests intercept external providers; live road/foot smoke tests are separate.
