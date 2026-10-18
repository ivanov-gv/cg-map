# Live transit relay

Read-only Podgorica bus positions for the optional web transport layer. This service is separate from the static Go host and GitHub Pages.

Canonical implementation: relay.mjs. worker.mjs is a portable Fetch API entry point. Node tests run with `node --test services/transit-relay/relay.test.mjs` from repository root.

## Source and behavior

- Public source UI: https://epodgorica.me/javniprevoz/mapa
- Upstream: https://adminapi.prevoz.podgorica.me/api/dispatcher/vehicles/public
- The source UI polls every 13 seconds; use the same cadence.
- Exact duplicates (route and coordinates) are removed; invalid coordinates are rejected.
- The upstream exposes routeName, latitude, and longitude, without vehicle IDs, GPS timestamps, heading, or speed. fetchedAt means the relay checked the feed, not that the bus transmitted its position then.
- Cached requests share a 13-second per-worker snapshot and in-flight refresh. Outages return explicitly stale data for at most 60 seconds, then 503.
- Fixed upstream only, GET/OPTIONS only, timeout, response-size limit, and public read CORS. This is not an arbitrary URL proxy.

## Hosted instance

The current deployment is recorded in deployment.json. It was built and deployed through the Sites skill with its supported server starter. The app/api/vehicles adapter invokes an exact copy of relay.mjs. The hosted scaffold's source is in the Site's managed source repository; relay.mjs here remains the canonical service logic.

For updates, open that same Site's source using the Sites workflow, copy relay.mjs into lib/relay.mjs, run service tests and the Site build, then save/deploy the matching source version. Preserve Site identity and access settings. Do not create a second instance, expose the service token in browser code, or put credentials in Git.

This instance is public following explicit owner authorization. Anonymous requests from the GitHub Pages origin can read the feed without service credentials.
