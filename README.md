# cg-map

A read-only vector map and place-directory PoC: pan/zoom, search/filter places, open details, and download for offline use. Public map editing is intentionally excluded.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the problem, company research, trade-offs, implementation walkthrough, source editing, deployment, scaling, and roadmap.

## Run

Python 3, no third-party runtime dependencies:

```sh
python3 server.py
```

Open **http://localhost:8080/**. Alternatively:

```sh
go run main.go
```

The included `web/` is ready to serve. Node/npm are only needed for rebuilding/tests. No API keys, paid library, database, CDN, cloud account, or Terraform is required for self-hosting.

Do not open the HTML directly as a file. Phone offline use requires HTTPS; plain HTTP on a LAN IP generally does not qualify. Desktop localhost does.

## Offline and coverage

Open the HTTPS site, choose **Download offline**, and wait for **READY** before disconnecting. The shell/places/fonts use a service-worker cache; the verified archive uses OPFS. An online Blob fallback is not a persistent offline download.

Browser quota/eviction, private browsing, cleared site data, and origin changes affect retention. A PWA is not a native storage guarantee.

Coverage: detailed buildings/businesses in central Podgorica, major roads and attractions across Montenegro. Snapshot: 17 October 2026. There are 1,811 places and a roughly 12.5 MB vector archive. This is not yet a complete national dataset.

## Build and test

Tested environment: Node 24 and Python 3.12. The optional Go host was not compiled here; the proposed CI includes that check.

```sh
npm ci --ignore-scripts
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r tools/requirements.txt
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
```

Rebuild geography from the included editable GeoJSON:

```sh
npm run build
```

After a place-only or design change, regenerate manifests without rebuilding geography:

```sh
node tools/finalize.mjs
```

The tile build can create about 230K temporary files and needs around 1 GB of temporary disk space. Fresh PBF imports via `tools/extract-osm.py` overwrite source files and do not merge local corrections. Read the guide first; metadata/count updates are not fully automated.

## Repository

| Path | Purpose |
| --- | --- |
| `web/` | Ready-to-serve application, vendored runtime, current map/places |
| `source-data/` | Editable display geometry and provenance |
| `tools/` | Build, package, manifest, and extraction tools |
| `tests/` | Automated checks and optional unexecuted browser script |
| `deployment/` | Example Caddy configurations |
| `.github/workflows/checks.yml` | Proposed GitHub CI, not yet run on your account |
| `research/` | Earlier source-linked research |
| `ARCHITECTURE.md` | Complete implementation and operations guide |
| `TESTING.md` | Verification record and gaps |

Serve `web/` on HTTPS, preferably with verified range support. Use atomic releases and retain older content-addressed archives. A host ignoring ranges triggers a complete archive load once per page session; avoid that path for a much larger dataset.

The clean export excludes Git history, hosting identity, credentials, dependencies, temporary files, and the raw upstream PBF. It includes all application source, editable GeoJSON, current map artifacts, and build/extraction tools. Original PBF download/checksum information is recorded separately.

Application code is MIT. Data and fonts retain separate licenses; see [DATA_LICENSE.md](DATA_LICENSE.md).

## GitHub Pages

The committed `docs/` folder is the static public map. In repository **Settings → Pages**, select **Deploy from a branch**, branch **main**, folder **/docs**.

Public URL: https://ivanov-gv.github.io/cg-map/

After changing or rebuilding `web/`, run `node tools/publish-pages.mjs` and commit both directories. This copies the complete app, map archive, fonts and offline assets; `.nojekyll` disables Jekyll processing. No backend or map rebuild is needed just to deploy the committed snapshot.
