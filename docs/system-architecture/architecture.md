# Current architecture

This is a monorepo of mostly independent projects. Source boundaries follow ownership; deployments consume built
artifacts rather than repository folders.

## Independent projects

Each project stands on its own: its own Makefile, build, run, lint and tests, its own instructions, and its own CI
pipeline. A change to one project runs only that project's pipeline, plus those of projects that consume a contract it
changed.

| Project                | Own Makefile targets              | CI pipeline       |
| ---------------------- | --------------------------------- | ----------------- |
| apps/web               | verify, build, dev, dev-mock, e2e | ci-apps-web       |
| apps/editor            | verify, build, dev, e2e           | ci-apps-editor    |
| apps/core-demo         | verify, build, dev, e2e           | ci-apps-core-demo |
| packages/map-core      | verify                            | ci-map-core       |
| packages/contracts     | verify                            | ci-contracts      |
| data                   | verify, check, build-data         | ci-data           |
| services/backend       | verify, check, build, generate    | ci-backend        |
| services/transit-relay | verify                            | ci-transit-relay  |
| platform               | verify, agent-rules, worktree     | ci-platform       |
| tests                  | verify                            | ci-tests          |

Projects depend on each other only through these concrete contracts:

| Contract                                      | Producer           | Consumers                                                 |
| --------------------------------------------- | ------------------ | --------------------------------------------------------- |
| Published `@ivanov-gv/map-core` package       | packages/map-core  | apps/web, apps/editor, at a pinned version                |
| Local map-core, unreleased                    | packages/map-core  | apps/core-demo                                            |
| Published `@ivanov-gv/map-data` package       | data               | map application and platform hosting tests, pinned        |
| Map data for an artifact, data/tools/app-data | data               | dev and CI artifact builds on main                        |
| Shared formats and schemas                    | packages/contracts | data, map-core, map applications, services/backend, tests |
| Reviewed sources, release archive and imagery | data               | dev and CI artifact builds, cross-component tests         |
| Editor source bundle                          | data               | apps/editor tests via the pin, integration tests at HEAD  |
| Place test fixture                            | data               | apps/web browser tests via the pin                        |
| Built web artifact, dist/web                  | apps/web           | platform hosting tests, tests                             |
| Built web artifact, dist/web                  | apps/web           | the dev Pages site                                        |
| Go host `run` target                          | services/backend   | apps/web `dev`                                            |
| Static host and per-worktree ports            | platform           | apps/web, apps/editor, apps/core-demo                     |

services/backend also hosts dist/web and reads the release at runtime. That is a runtime contract only: its tests use a
synthetic artifact, so it has no pipeline dependency on either. The tests project exists to check these contracts, so it
is the one project that may import other projects' code.

Rules:

- The root Makefile holds repository-wide tasks only: setup, hooks, checking every project, CI planning, workflow test
  runs. It may call a project's check targets; it never calls a project's build or run targets directly.
- A project never runs another project's checks or tests. Applications never import each other.
- A new dependency between projects needs a row above, and a rule in platform/tools/ci-plan.mjs that runs the consumers
  when the producer changes. Runtime-only contracts are the exception.
- A project's tests read only its own files or an exact published version of another project, never another project's
  HEAD. A change in one project never requires test changes in another. For example, app and platform hosting tests pin
  `@ivanov-gv/map-data`. The scoped exception is `tests/`, the cross-project integration project, which tests HEAD
  contracts by design.

### Map data modes

Map data reaches an application in three distinct ways:

1. App tests (unit and browser) and the platform hosting test's web build read the exact `@ivanov-gv/map-data` release
   pinned in their owning manifest, resolved by a pinned-data helper. A data-only change selects no app or platform
   pipeline.
2. Dev and CI artifact builds on main read the repository `data/` and its tools at the checked-out commit (HEAD), so
   developers and the dev site see unreleased data without publishing it.
3. A future app production release pins every dependency, data included. No app production release exists yet, so this
   is a rule for future CD; the map-data release CD promotes data packages and is not an app release mode.

Only the first mode reads the installed package; the others read repository data and its tools together. See
[releasing map data](../runbooks/release.md#releasing-map-data).

To add a project, create its folder, Makefile, tests, README.md and AGENTS.md and its `ci-<name>.yml` pipeline, then
register it: `PROJECTS` and `test-ci-*` in the root Makefile, `components` in platform/tools/verify.mjs, `FOLDERS` and a
rule in platform/tools/ci-plan.mjs, a job and gate entry in ci-pr-checks.yml, and platform/tools/check-repo.mjs. A
browser app also joins `BROWSER_PROJECTS`, and the app lists in platform/tools/serve.py and dev-port.mjs. It never gets
a slot in an existing project's Makefile, tests or pipeline.

## Implemented stack

| Concern         | Implementation                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web             | Plain JavaScript ES modules, HTML/CSS; MapLibre GL JS 5.12.0                                                                                                                                                                                                                                                                                                       |
| Vector map      | PMTiles v3, PMTiles JS 4.3.0, precomputed MVT                                                                                                                                                                                                                                                                                                                      |
| Directory       | GeoJSON snapshot with browser-side search                                                                                                                                                                                                                                                                                                                          |
| Point selection | Feature details and From/To endpoints in browser session state                                                                                                                                                                                                                                                                                                     |
| Routing         | FOSSGIS/OSRM car + foot APIs; local representative bus-pattern search with up to one transfer                                                                                                                                                                                                                                                                      |
| Satellite       | Local bounded zoom-17 WebP sample and preview                                                                                                                                                                                                                                                                                                                      |
| Offline         | Service worker/Cache Storage for shell; OPFS for verified archive                                                                                                                                                                                                                                                                                                  |
| Data pipeline   | Node 24, geojson-vt 4.0.2, vt-pbf 3.1.3; Python PMTiles, optional osmium/Shapely                                                                                                                                                                                                                                                                                   |
| Backend         | Independent Go module with ConnectRPC and protobuf transport definitions: static artifact host, map layers API (TileJSON + vector tiles from the release archive), live ePodgorica vehicles API with movement directions, web config (`config.json`)                                                                                                               |
| Delivery        | ci-publish builds the dev site image `dev-pages:<sha>` with `version.json`; cd-dev-pages pulls the image by SHA and deploys to Pages via `workflow_run` (only for successful push on main): [release](../runbooks/release.md). PR checks have a time budget enforced by `CI gate`: aim 5 minutes, limit 7, starting at the later of approval and run attempt start |
| Verification    | ESLint, markdownlint/Prettier, Node tests, Python unittest, Playwright; separate Go vet/lint/test/build                                                                                                                                                                                                                                                            |

The Go server is optional. When the app is served by it, `config.json` selects server mode and the app reads layers and
vehicles from its APIs. Static hosts such as GitHub Pages serve the artifact's own `config.json`, which selects mock
mode: the current static data (the release archive read directly and the hosted relay). `?api=server|mock` overrides
either. See [backend](../../services/backend/README.md). There is no editorial API, database, self-hosted routing
engine, editorial system, or server-side search today. Transport also has a protobuf-defined ConnectRPC interface; the
existing browser keeps its GeoJSON endpoint until a UI migration. Both interfaces share the observed feed and cache. The
optional live transport layer uses a separate read-only vehicle relay; its hosted endpoint is public. Route planning
uses external car/foot routing and local dated bus patterns; see [routing behavior](../ui-ux/features/routing.md).

## Ownership boundaries

- packages/map-core: shared map lifecycle, cartography, satellite/POI rendering, projection, hit testing and overlays.
- apps/web: public UI, client search, routes, transport, offline behavior, web assembly, and browser acceptance.
- apps/editor: separately built source editor. It exports reviewable changesets and never writes sources itself.
- apps/core-demo: minimal consumer exposing shared capabilities without importing either application.
- services/backend: server implementation; future editorial/auth/search capabilities when required.
- data: acquisition, source snapshots, imagery/provenance, quality, tile generation, data releases.
- packages/contracts: stable formats shared across producers and consumers.
- platform: hosting, CI/deployment, local infrastructure, repository enforcement.
- tests: cross-component contract and artifact integration. Each browser app owns its browser acceptance; unit tests
  stay with their components.

See [ownership](ownership.md) for teams, interfaces, and future split triggers.

## Build and runtime flow

1. data/sources and data/imagery hold reviewed editable inputs. data/artifacts/release.json identifies the current
   content-addressed archive and checksum.
2. data/tools validates sources against provenance and shared contracts. Full geography regeneration is an explicit,
   separate operation.
3. apps/web/tools/build.mjs assembles public assets and runtime modules with the reviewed data release into dist/web. It
   generates offline manifests there.
4. A PR's CI tests the assembled artifact at / and /cg-map/, including real archive download and offline reload. The
   nightly run does the same on main.
5. A merge to main triggers ci-publish, whose `pages` job builds all three apps from source, writes version.json with
   the commit SHA, and pushes the image as `dev-pages:<sha>`. When ci-publish completes successfully on main,
   cd-dev-pages is triggered via `workflow_run`, pulls the image by commit SHA, extracts the site, and deploys it to
   GitHub Pages. CD never runs for a CI test run, a dispatched CI run, a failed or cancelled run, or any branch but
   main. Source files, docs, datasets used for generation, and backend code are excluded.

The web app runs at /cg-map/web/, and owns only that path's worker. No deployment redirect or web asset tree is
committed in repository root.

## Browser dependencies

app.js orchestrates startup, directory state and controller wiring. place-selection.js owns selected objects and
deferred camera/focus transitions; location-controls.js owns in-memory positioning; offline-controls.js presents archive
actions. place-details.js renders card/results content, map-selection.js resolves hits, and public-map-layers.js
installs app-owned overlays. status-messages.js is pure wording. interface.js owns the overlay dock, compact mobile
search, focus, and visible-viewport geometry. Map gestures are MapLibre's own, unchanged
([ADR 0015](../decisions/0015-maplibre-gestures-unchanged.md)). app.js imports the map-core entry and the public
workflow modules. offline.js imports core.js for formatting; core.js has no local imports. The map-core package imports
no app code. app-updates.js checks for releases once per page load or reload; sw.js installs a complete replacement
shell before activating and reloading open tabs. sw.js imports its generated offline manifest. Repository checks enforce
these boundaries.

Shared place categories live in the published contract; integration tests verify UI categories agree. Data validation
never imports web code. The backend module builds without npm or raw datasets.

## Known limits

Incomplete coverage, legacy geometry identity, GIS topology, imagery rights, browser eviction, phone GPU performance,
archive retention, and larger editorial workflows remain documented in [technical debt](technical-debt.md).

Further reading: [web guide](../../apps/web/README.md), [data pipeline](../runbooks/data.md),
[release](../runbooks/release.md), [testing](../verification/testing.md), and
[historical implementation guide](historical-implementation-guide.md).

## Live transport

See [transport behavior](../ui-ux/features/transport.md). The optional client layer polls public ePodgorica positions
through the Go server (server mode) or the read-only hosted relay (mock mode, GitHub Pages). A server-side hop exists
because the upstream restricts browser origins. Bus markers point in the direction of travel when it is known from
movement, show an outlined estimate from the route until then, or a plain disc when neither is available. The public
hosted endpoint and deployment identity are recorded with the service. Live data is separate from offline map packages.

## Additional browser artifacts

apps/core-demo and apps/editor build their own artifacts, dist/core-demo and dist/editor. Pages publishes all three
apps, each under its own path. [source editor](../../apps/editor/README.md) verifies a data-owned hash-pinned source
bundle and exposes one editing mode per source GeoJSON. It never writes sources: it exports changesets, which the
data-owned importer applies. It installs on the owner's devices from a local HTTPS server and then runs offline, keeping
its map archive whole in a cache of its own and answering range reads from that copy. Both consume the
[map-core contract](../../packages/map-core/README.md), with local assets and relative URLs.
