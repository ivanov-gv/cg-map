# cg-map / Kompas

A read-only Montenegro map and place directory: vector map, local search, place details, a central Podgorica satellite sample, and explicit offline download. Coverage is incomplete; the current snapshot and counts are recorded in source provenance.

## Start

```sh
python3 server.py
```

Open http://localhost:8080/. No external runtime services or API keys are required. The optional Go host is `go run .`. Phone offline use requires HTTPS; desktop localhost also works.

## Develop and verify

Use Node 24 and Python 3.12:

```sh
make setup
make dev
make check
```

After editing runtime assets or places:

```sh
make pages
make check
npx playwright install chromium
make test-e2e
```

`make build` rebuilds geometry and needs the optional Python build dependencies. UI changes do not need it. See [development](docs/runbooks/development.md), [data](docs/runbooks/data.md), and [testing](docs/testing.md).

## Repository map

| Path | Purpose |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Agent entry point and commands |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Current stack, boundaries, data flow |
| [docs/](docs/README.md) | Runbooks, decisions, plans, detailed design |
| [web/](web/README.md) | Editable app and ready-to-serve source assets |
| source-data/ | Editable display geometry and provenance |
| tools/ | Builds, publication, validation |
| tests/ | Unit, data, transport, publication, and browser tests |
| deployment/ | Example Caddy configurations |
| Root app assets | Generated GitHub Pages copy; edit web/ instead |

## GitHub Pages

Public URL: https://ivanov-gv.github.io/cg-map/

The prepared publishing source is **main → / (root)**. The owner must change the Pages folder setting from /docs separately. `docs/` now holds actual documentation. See [release and rollback](docs/runbooks/release.md).

The satellite sample is local imagery served by eMapa as Ortofoto 2025; redistribution rights remain unverified. Application code is MIT; data and fonts retain separate licenses. See [DATA_LICENSE.md](DATA_LICENSE.md).
