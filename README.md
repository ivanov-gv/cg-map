# Maps for Montenegro / Kompas

Monorepo for a Montenegro map and place directory. The current product is a static, read-only PoC with local search, place details, a satellite sample, and explicit offline download.

## Components

| Path | Responsibility |
| --- | --- |
| [apps/web](apps/web/README.md) | Browser experience, rendering, offline UI |
| [services/backend](services/backend/README.md) | Independent Go module; currently an optional static host |
| [data](data/README.md) | Source datasets, imagery, validation, tile pipeline, reviewed artifacts |
| [packages/contracts](packages/contracts/README.md) | Published data formats shared by producers/consumers |
| [platform](platform/README.md) | Development hosting, release infrastructure, repository checks |
| [tests](tests/README.md) | Cross-component integration and browser acceptance |
| [docs](docs/README.md) | Architecture, ownership, decisions, and runbooks |

See [team boundaries](docs/ownership.md) and [current architecture](ARCHITECTURE.md). Future backend/editorial capabilities are proposals, not implemented services.

## Develop

Node 24 and Python 3.12:

```sh
make setup
make dev
```

Open http://localhost:8080/. The web build assembles apps/web, the current data release, and compatibility assets into ignored dist/web. No runtime API keys or external services are required.

```sh
make check       # Build and validate web/data/contracts/platform
make test-e2e    # Real browser acceptance
make check-go    # Independent Go module; requires Go
```

`make build` builds the web artifact. `make build-data` deliberately regenerates geography and requires [optional Python dependencies](docs/runbooks/data.md). Do not rebuild geography for UI changes.

## Publication

[Web checks and Pages](.github/workflows/web.yml) builds and tests dist/web, then deploys that artifact to GitHub Pages on main. Pull requests run checks without deploying. Backend checks run separately.

Public URL: https://ivanov-gv.github.io/cg-map/. GitHub Pages source is **GitHub Actions**; no branch-folder setting or committed deployment copy is needed.

Application code is MIT. Datasets/fonts have separate terms; satellite redistribution rights remain unverified. See [DATA_LICENSE.md](DATA_LICENSE.md).
