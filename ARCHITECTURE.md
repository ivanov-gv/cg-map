# Current architecture

This is a concern-based monorepo. Source boundaries follow ownership; deployments consume built artifacts rather than repository folders.

## Implemented stack

| Concern | Implementation |
| --- | --- |
| Web | Plain JavaScript ES modules, HTML/CSS; MapLibre GL JS 5.12.0 |
| Vector map | PMTiles v3, PMTiles JS 4.3.0, precomputed MVT |
| Directory | GeoJSON snapshot with browser-side search |
| Satellite | Local bounded zoom-17 WebP sample and preview |
| Offline | Service worker/Cache Storage for shell; OPFS for verified archive |
| Data pipeline | Node 24, geojson-vt 4.0.2, vt-pbf 3.1.3; Python PMTiles, optional osmium/Shapely |
| Backend | Independent Go module; optional static HTTP host only |
| Delivery | GitHub Actions uploads/deploys dist/web to Pages |
| Verification | ESLint, Node tests, Python unittest, Playwright; separate Go vet/test/build |

There is no application API, database, routing engine, editorial system, or server-side search today.

## Ownership boundaries

- apps/web: UI, rendering, client search, offline behavior, web assembly.
- services/backend: server implementation; future editorial/auth/search capabilities when required.
- data: acquisition, source snapshots, imagery/provenance, quality, tile generation, data releases.
- packages/contracts: stable formats shared across producers and consumers.
- platform: hosting, CI/deployment, local infrastructure, repository enforcement.
- tests: cross-component integration and browser acceptance. Unit tests stay with components.

See [ownership](docs/ownership.md) for teams, interfaces, and future split triggers.

## Build and runtime flow

1. data/sources and data/imagery hold reviewed editable inputs. data/artifacts/release.json identifies the current content-addressed archive and checksum.
2. data/tools validates sources against provenance and shared contracts. Full geography regeneration is an explicit, separate operation.
3. apps/web/tools/build.mjs assembles public assets and runtime modules with the reviewed data release into dist/web. It generates offline manifests there.
4. CI tests the assembled artifact at / and /cg-map/, including real archive download and offline reload.
5. The Pages deploy job publishes only that verified artifact. Source files, docs, datasets used for generation, and backend code are excluded.

The app runs directly at /cg-map/. Compatibility entries in the artifact redirect old /cg-map/web/ bookmarks and retire the earlier nested worker. The new app owns the root worker. No deployment redirect or web asset tree is committed in repository root.

## Browser dependencies

app.js orchestrates DOM/map state and imports core.js, map-style.js, satellite.js, and offline.js. offline.js imports core.js for formatting; the other helpers have no local imports. sw.js imports its generated offline manifest. Repository checks enforce these boundaries.

Shared place categories live in the published contract; integration tests verify UI categories agree. Data validation never imports web code. The backend module builds without npm or raw datasets.

## Known limits

Incomplete coverage, legacy geometry identity, GIS topology, imagery rights, browser eviction, phone GPU performance, archive retention, and larger editorial workflows remain documented in [technical debt](docs/technical-debt.md).

Further reading: [web guide](apps/web/README.md), [data pipeline](docs/runbooks/data.md), [release](docs/runbooks/release.md), [testing](docs/testing.md), and [detailed earlier design](docs/design/implementation-guide.md).
