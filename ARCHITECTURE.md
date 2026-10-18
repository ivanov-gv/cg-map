# Current architecture

Kompas is a static, read-only Montenegro map and place directory. Application source is `web/`; GitHub Pages publishes from the repository root, whose small entry page opens `web/`. There is one application asset tree. Change the Pages setting to **main / (root)** after this migration. `docs/` is documentation.

## Implemented stack

| Layer | Implementation | Responsibility |
| --- | --- | --- |
| UI | Plain JavaScript ES modules, HTML, CSS | Search, categories, results, details, responsive layout |
| Rendering | MapLibre GL JS 5.12.0 / WebGL | Vector/raster layers, camera, labels, clustered places |
| Basemap | MVT in PMTiles v3; PMTiles JS 4.3.0 | Land, water, roads, buildings; range reads |
| Directory | Local GeoJSON | Browser-side search; provenance records the reviewed count |
| Satellite | 16 local zoom-17 WebP tiles and preview | Bounded central Podgorica sample |
| Offline shell | Service worker / Cache Storage | UI, glyphs, places, imagery |
| Offline archive | OPFS | Verified archive download and local reads |
| Data build | Node 24, geojson-vt 4.0.2, vt-pbf 3.1.3; Python PMTiles | GeoJSON → MVT → content-addressed archive |
| Optional import | Python osmium / Shapely | OSM extraction; not needed to run the snapshot |
| Hosting | GitHub Pages; optional Python or Go static hosts | Static files; range transport |
| Verification | ESLint, Node tests, Python unittest, Playwright, GitHub Actions | Contracts, provenance, browser behavior, repository layout |

There is no backend API, database, React application, routing graph, or server-side search. Go is an optional static host, not an application backend.

## Runtime modules and boundaries

| Module | Responsibility | Allowed local imports |
| --- | --- | --- |
| `web/app.js` | DOM/map orchestration and UI state | core, map-style, satellite, offline |
| `web/core.js` | Pure directory/search helpers | None |
| `web/map-style.js` | Construct MapLibre style | None |
| `web/satellite.js` | Install/toggle local raster layers | None |
| `web/offline.js` | Archive transport and verified storage | core |
| `web/sw.js` | Shell cache lifecycle and navigation | Generated offline-manifest via importScripts |

`tools/check-repo.mjs` checks the dependency graph. Add new boundaries deliberately when introducing a module. Build tools may consume source data; runtime modules consume published assets only.

## Data and release flow

1. Editable geometry lives in `source-data/`; place records live in `web/data/places.geojson`.
2. `npm run build` generates tiles, packages PMTiles, and finalizes manifests. This expensive pipeline is only needed for geometry changes.
3. `npm run release:prepare` regenerates offline identity and keeps runtime assets in place. It does not rebuild geometry.
4. Root `index.html` forwards to `web/`, preserving query/hash and the project prefix. Root `sw.js` retires the old root-scoped worker; the application owns `web/sw.js`.
5. Browser requests use relative paths, supporting both `/` and the `/cg-map/` project prefix. Root and prefix browser tests cover this contract.

The browser fetches manifests and places, loads the vector archive through PMTiles, and renders one persistent map. Explicit offline download verifies the archive before switching to local storage. The service worker caches shell assets and excludes archive/range requests.

## Constraints and known limits

- Dataset coverage is incomplete; use provenance and manifests for current counts and hashes.
- Structural validation checks coordinate ranges, shape, IDs for places, and source checksums. It does not prove GIS topology or that listings are current.
- Basemap extracts do not preserve reliable upstream identity for conflation.
- Satellite redistribution rights remain unverified; preserve its existing provenance record.
- Device GPU performance, browser eviction, and phone offline behavior require real-device checks.
- Branch-based Pages serves the single `web/` tree through a root entry page. Large future artifacts should move to versioned artifact storage.

## Further reading

- [Docs index](docs/README.md)
- [Frontend implementation guide](web/README.md)
- [Detailed design, research, and growth options](docs/design/implementation-guide.md)
- [Data pipeline](docs/runbooks/data.md)
- [Release and rollback](docs/runbooks/release.md)
- [Testing](docs/testing.md)

## Host layout

`cmd/kompas/main.go` is the optional Go static host. It serves assets from disk (`-dir web` by default). `tools/serve.py` is the Python development host. Neither is part of the browser runtime.
