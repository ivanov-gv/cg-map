# Live Podgorica transport

## Product behavior

The optional Transport toggle adds blue route-number markers without replacing the map. It works with street/satellite views. Updates run every 13 seconds only while enabled and visible. Switching it off cancels requests and clears positions.

The panel names ePodgorica as the source and displays when the feed was checked. The provider does not expose GPS timestamps or stable vehicle IDs. Do not label a marker with invented speed, direction, bus identity, or GPS age. Duplicate route/coordinate entries are merged.

Offline mode clears positions and explains that live buses require a connection. Failed refreshes mark existing data as delayed; positions older than 60 seconds are removed. Live data is never placed in offline manifests, Cache Storage, or OPFS. Offline map/download functionality remains separate.

## Integration

The source UI is https://epodgorica.me/javniprevoz/mapa. Its shipped frontend requests https://adminapi.prevoz.podgorica.me/api/dispatcher/vehicles/public every 13 seconds. A direct GET from the GitHub origin receives no allowed-origin header; the ePodgorica origin receives its own allow-origin response. Pages cannot proxy that server-side.

services/transit-relay implements a fixed-upstream read-only relay with bounded fetches, duplicate filtering, a brief shared cache, CORS, and explicit stale/expiry responses. apps/web/src/transport.js validates and renders the published GeoJSON contract. Source details were inspected on 2026-10-18. No login, cookies, access tokens, or private vehicle endpoints are used upstream.

## Current release status

The hosted relay is public following explicit owner authorization. An anonymous live smoke test returned HTTP 200 and actual upstream bus positions with public read CORS. A Chromium fetch from https://ivanov-gv.github.io also returned HTTP 200 with 16 positions and stale=false. Desktop/mobile browser tests use deterministic intercepted feed responses; that is separate from live relay verification.

The GitHub Pages client calls the public hosted endpoint. Deployment runs through the web Actions workflow after merge to main.

Hosting identity and source version are in [deployment.json](../services/transit-relay/deployment.json). The service implementation and update procedure are in [its README](../services/transit-relay/README.md).

## Bus stops

Transport also shows 719 official stops from a reviewed ePodgorica snapshot retrieved 18 October 2026. Hollow blue circles appear at zoom 13; names appear at zoom 16. Tap a stop for its name, source ID, snapshot date, and From/To actions. Stops remain visible offline and while live vehicle updates are unavailable; disabling Transport hides both layers and closes stop details.

The snapshot is data/sources/transport-stops.geojson with its own provenance JSON, source URL, count, byte size, and SHA-256. It is copied into the web artifact and offline shell; vehicle positions remain excluded. To refresh deliberately, fetch /api/gtfs/stops/all, preserve stopId/name/longitude/latitude, validate unique IDs and coordinates, update provenance/date UI, and run make check plus browser acceptance. This refresh does not require rebuilding the basemap archive. Stop details do not imply live arrival predictions.
