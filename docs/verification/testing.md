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

| Location                     | Scope                                                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/map-core/tests      | Asset URLs, lifecycle and teardown, projection, hit testing, overlay selection, satellite, POI visibility                                             |
| apps/editor/tests            | Editing rules, session and history, gestures, changesets, drafts, source bundle integrity, overlay hit resolution, unknown property preservation      |
| apps/core-demo/tests         | The concept app imports only the public map-core entry                                                                                                |
| apps/web/tests               | Pure helpers, offline transactions and module inventory, worker lifecycle, vendor contracts                                                           |
| data/tests                   | Place/geometry contracts and approved small fixture                                                                                                   |
| platform/tests               | Actual Python HTTP/range behavior, LAN certificates and TLS, deployment compatibility                                                                 |
| services/transit-relay/tests | Relay normalization, cache sharing, stale outage behavior, and read-only methods                                                                      |
| services/backend/cmd/server  | Go host directory/range behavior                                                                                                                      |
| tests/integration            | Real archive/MVT decoding, imagery hashes, shared categories, transport, editor changesets through the real importer, editor source bundle round trip |
| apps/web/tests/e2e           | Built web artifact, desktop/mobile, origin/project-prefix URLs, real offline download/reload                                                          |
| apps/editor/tests/e2e        | Built source editor: every edit through the real map, including touch; offline install and updates, desktop/mobile, origin/project-prefix URLs        |
| apps/core-demo/tests/e2e     | Built concept app and each map-core capability, desktop/mobile, origin/project-prefix URLs                                                            |

make check runs `verify` in every project, which together build dist/web, dist/core-demo and dist/editor and run
Node/Python tests, JavaScript lint, all-source Markdown structure/format checks, data/provenance/release checks,
docs/layout/dependency checks, and generated manifest verification. `make check-go` independently runs Go vet,
golangci-lint, tests, and build. See
[Markdown checks and formatting](../runbooks/development.md#markdown-checks-and-formatting) for the shared rules and fix
command.

Each browser project runs Playwright against its own built artifact. For the deployable web artifact, it tests / and
/cg-map/, fixture-backed search/selection, satellite switching with one map instance, and downloading/reloading the
reviewed archive offline. Discover checks cover the street-scale first view and key, granted/denied location states,
country-scale POI suppression, and named layer failures; geolocation is emulated, so physical-device fixes remain a
manual check. Compatibility tests preserve old /web/ entry behavior. On failure, traces/screenshots are uploaded by CI.

These checks do not prove GIS topology, real-world listing freshness, phone GPU performance, or persistent storage
retention. Test the target phone for gestures, rotation/folding, interrupted/full-storage downloads, airplane-mode
reopening, eviction, and long-running memory/frame behavior.

The detailed earlier design guide includes historical verification evidence. Current commands, ownership, and CI are
authoritative for this layout.

## What runs in CI

[ci-all](../../.github/workflows/ci-all.yml) calls one workflow per project, chosen from the diff by
[the planner](../../platform/tools/ci-plan.mjs), and reports one `CI gate`. Anything the planner cannot classify runs
everything.

| Changed                                                     | Runs                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Markdown, except under `apps/*/public`                      | `docs` only: no code checks                                                                 |
| Backend Go code                                             | `backend` only                                                                              |
| `services/transit-relay`                                    | `transit-relay`                                                                             |
| `platform/pages`                                            | `platform`, `apps-web`, every browser area                                                  |
| `platform/tools/serve.py`, `dev-port.mjs`                   | `platform`, every map application, every browser area                                       |
| `platform/browser-image`                                    | `browser-image`, `platform`                                                                 |
| `platform/tools/lan_certificate.py`                         | `platform`, `apps-editor`                                                                   |
| `tests`, `data/tools`, `data/tests`, the rest of `platform` | That folder, except as listed below                                                         |
| `apps/web`                                                  | `apps-web`, `tests`, `platform`, and the browser areas below                                |
| `apps/editor`                                               | `apps-editor`, `tests`, and the editor browser areas below                                  |
| `apps/core-demo`                                            | `apps-core-demo`                                                                            |
| `packages/map-core`                                         | `map-core`, every map application, `tests`, `platform`, every browser area                  |
| `data/tools/editor-bundle.mjs`                              | `data`, `apps-editor`, `tests`                                                              |
| `data/tools` changeset importer, data check, level policy   | `data`, `tests`                                                                             |
| `data/tests/fixtures`                                       | `data`, `apps-web`, `tests`, `platform`, every browser area                                 |
| `data/sources`, `artifacts`, `imagery`                      | `data`, every map application, `tests`, `platform`, every browser area                      |
| `packages/contracts`                                        | Those, plus `map-core`, `contracts` and `backend`                                           |
| `.github`, the planner                                      | `workflows`, `platform`, plus test runs: see [.github/TESTING.md](../../.github/TESTING.md) |
| Root files such as `package-lock.json`, or unknown paths    | Everything                                                                                  |

Check a branch with `make ci-plan BASE=origin/main`.

## Phone layout tests

A PR runs web and editor tests on the phone layout only when they are tagged `@phone`. The nightly run and a plain
`make e2e` run them all, so a phone-only bug that a tag misses appears at most a day later. The desktop layout always
runs everything. List what a PR runs with `E2E_PHONE=tagged npx playwright test --list --project=pages-mobile`.

Tag a test `@phone` when it:

- only runs on the phone layout, or behaves differently there, branching on `isMobile`, `hasTouch`, touch input or the
  viewport width, in its own body, a helper it calls, or the skips and hooks of its describe: a check in
  [phone-tags](../../platform/tools/phone-tags.mjs) fails if such a test has no tag. A helper that only chooses how to
  press something on each layout, such as `closeCard`, is listed as neutral in its test;
- needs the `/cg-map/` prefix, which only the phone project uses;
- is the one whole journey for its app, or its one check of layout overflow.

The editor's install test is also tagged. The web app has no install test to tag.

## Browser test areas

Browser tests are split by area. CI builds once, then runs each selected area as its own job with its own time limit.
Pull requests run only the areas a change maps to, and the nightly run checks every area. Pushes to main run no tests:
see [the decision](../decisions/0006-ci-time-limits-and-tests-before-merge.md).

| Area        | Specs in apps/web/tests/e2e                     | Covers                                                  | Code it depends on most                                                       |
| ----------- | ----------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| shell       | shell.spec.mjs, updates.spec.mjs                | Startup, offline download, updates, hosting, data modes | sw.js, offline.js, data-mode.js, tools/, platform/pages, data/artifacts       |
| journeys    | journeys.spec.mjs, in two jobs                  | Point selection, routes, transport, buildings, map taps | routing, transport, point-selection, object-selection, map-taps, data transit |
| interface   | interface.spec.mjs                              | Search, dock, place card, phone keyboard, focus zone    | interface.js, index.html, style.css                                           |
| discover    | discover.spec.mjs                               | First view, scale, location states                      | position.js, data/sources/places*, contracts                                  |
| poi-desktop | poi-visibility.spec.mjs, root-desktop, two jobs | POI levels, chooser                                     | data/sources/places*, contracts                                               |
| poi-mobile  | poi-visibility.spec.mjs, pages-mobile project   | POI levels, chooser                                     | data/sources/places*, contracts                                               |

app.js, core.js, packages/map-core, style.css, index.html, shared test helpers, build tools, and anything unmapped run
every area, because every browser test boots them.

The editor's areas work the same way, from `EDITOR_BROWSER_AREAS` in the planner:

| Area            | Specs in apps/editor/tests/e2e           | Code it depends on most                                      |
| --------------- | ---------------------------------------- | ------------------------------------------------------------ |
| editing-desktop | editing.spec.mjs, root-desktop, two jobs | Commands, session, validation, inspector, review             |
| editing-mobile  | editing.spec.mjs, pages-mobile           | The same                                                     |
| offline-desktop | offline.spec.mjs, root-desktop           | sw.js, offline-cache.js, offline-install.js, update-quiet.js |
| offline-mobile  | offline.spec.mjs, pages-mobile           | The same                                                     |
| viewer          | viewer.spec.mjs                          | source-overlay.js                                            |

app.js, dom.js, hashing.js, source-bundle.js, draft-store.js, public/, build tools, and anything unmapped run every
editor area, as does a change from outside the editor that selects it, such as its source bundle.

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
