# Testing

## Commands

```sh
make setup
make check
npx playwright install chromium
make test-e2e
make check-go
```

On Ubuntu 26.04, Playwright 1.56 has no Chromium build; install the 24.04 one with
`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright install chromium` (see
[technical debt](../system-architecture/technical-debt.md)).

Frontend iteration commands and measured check durations live with the
[web application](../../apps/web/README.md#focused-browser-checks).

## Test ownership

| Location                     | Scope                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| apps/web/tests               | Pure helpers, satellite behavior, offline transactions and module inventory, worker lifecycle, vendor contracts |
| data/tests                   | Place/geometry contracts and approved small fixture                                                             |
| platform/tests               | Actual Python HTTP/range behavior, deployment compatibility                                                     |
| services/transit-relay/tests | Relay normalization, cache sharing, stale outage behavior, and read-only methods                                |
| services/backend/cmd/server  | Go host directory/range behavior                                                                                |
| tests/integration            | Real archive/MVT decoding, imagery asset hashes, shared-category agreement, transport                           |
| apps/web/tests/e2e           | Built artifact, desktop/mobile, origin/project-prefix URLs, real offline download/reload                        |

make check builds dist/web and runs Node/Python tests, JavaScript lint, all-source Markdown structure/format checks,
data/provenance/release checks, docs/layout/dependency checks, and generated manifest verification. The backend workflow
independently runs Go vet, tests, and build. See
[Markdown checks and formatting](../runbooks/development.md#markdown-checks-and-formatting) for the shared rules and fix
command.

Playwright runs against the actual deployable artifact. It tests / and /cg-map/, fixture-backed search/selection,
satellite switching with one map instance, and downloading/reloading the reviewed archive offline. Discover checks cover
the street-scale first view and key, granted/denied location states, country-scale POI suppression, and named layer
failures; geolocation is emulated, so physical-device fixes remain a manual check. Compatibility tests preserve old
/web/ entry behavior. On failure, traces/screenshots are uploaded by CI.

These checks do not prove GIS topology, real-world listing freshness, phone GPU performance, or persistent storage
retention. Test the target phone for gestures, rotation/folding, interrupted/full-storage downloads, airplane-mode
reopening, eviction, and long-running memory/frame behavior.

The detailed earlier design guide includes historical verification evidence. Current commands, ownership, and CI are
authoritative for this layout.

## Browser test areas

Browser tests are split by area. CI builds once, then runs each area as its own job with its own time limit. The
`Browser acceptance` job reports their combined result, and deployment waits for it.

| Area      | Specs in apps/web/tests/e2e                | Covers                                                  | Code it depends on most                                                         |
| --------- | ------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| shell     | shell.spec.mjs, updates.spec.mjs           | Startup, offline download, updates, hosting, data modes | sw.js, offline.js, data-mode.js, tools/, platform/pages, data/artifacts         |
| journeys  | journeys.spec.mjs                          | Point selection, routes, transport, buildings, map taps | routing, transport, point-selection, object-selection, map-taps, data transit   |
| interface | interface.spec.mjs                         | Search, dock, place card, phone keyboard, focus zone    | interface.js, index.html, style.css                                             |
| places    | discover.spec.mjs, poi-visibility.spec.mjs | First view, scale, POI levels, chooser                  | place-visibility.js, poi-icons.js, position.js, data/sources/places*, contracts |

All areas always run; there is no path filtering yet. app.js, core.js, and map-style.js are shared by every area, so a
future filter must treat them, shared helpers, dependencies, and the workflow itself as running everything. A filter
must also keep a full run on `main` before deployment, so a wrong mapping cannot reach users.

## Monorepo verification — 2026-10-18

Executed locally: 35 Node tests, five Python tests, six Playwright tests, lint, source/release/contract validation,
documentation/boundary checks, offline manifests, and both workspace-local test commands. The full geography pipeline
was not rerun: source geometry and archive bytes were moved unchanged. Backend Go checks and the actual Pages deployment
are verified by their GitHub workflows.

Transport feature verification: relay/cache/stale lifecycle unit tests, client late-response/expiry tests,
desktop/mobile toggling and failure/offline acceptance. The public hosted relay returned actual upstream positions with
anonymous access and public read CORS. Browser acceptance uses deterministic responses; live integration is smoke-tested
separately.

Route planning: provider tests block service workers so the offline shell cannot substitute the real network for
deterministic fixtures. Car/foot profiles, validation, cached/cancelled requests, direct and one-transfer bus search,
mode switching, missing routes, identical points and clearing are covered. The separate offline acceptance test uses the
actual bundled bus network and cached map. Live provider smoke tests are separate from mocked browser acceptance.
