# Live Podgorica transport

## Product behavior

The optional Transport toggle adds blue route-number markers without replacing the map. It works with street/satellite views. Updates run every 13 seconds only while enabled and visible. Switching it off cancels requests and clears positions.

The panel names ePodgorica as the source and displays when the feed was checked. The provider does not expose GPS timestamps or stable vehicle IDs. Do not label a marker with invented speed, direction, bus identity, or GPS age. Duplicate route/coordinate entries are merged.

Offline mode clears positions and explains that live buses require a connection. Failed refreshes mark existing data as delayed; positions older than 60 seconds are removed. Live data is never placed in offline manifests, Cache Storage, or OPFS. Offline map/download functionality remains separate.

## Integration

The source UI is https://epodgorica.me/javniprevoz/mapa. Its shipped frontend requests https://adminapi.prevoz.podgorica.me/api/dispatcher/vehicles/public every 13 seconds. A direct GET from the GitHub origin receives no allowed-origin header; the ePodgorica origin receives its own allow-origin response. Pages cannot proxy that server-side.

services/transit-relay implements a fixed-upstream read-only relay with bounded fetches, duplicate filtering, a brief shared cache, CORS, and explicit stale/expiry responses. apps/web/src/transport.js validates and renders the published GeoJSON contract. Source details were inspected on 2026-10-18. No login, cookies, access tokens, or private vehicle endpoints are used upstream.

## Current release status

The hosted relay is owner-private pending explicit public-access authorization. Its protected live smoke test returned HTTP 200 and 18 distinct bus positions. Desktop/mobile browser tests use deterministic intercepted feed responses; that is separate from the live relay verification.

The feature is prepared on a review branch. Do not merge it or claim publicly working live positions until the relay is public, the GitHub-origin browser fetch succeeds, and the Pages deployment is verified.

Hosting identity and source version are in [deployment.json](../services/transit-relay/deployment.json). The service implementation and update procedure are in [its README](../services/transit-relay/README.md).
