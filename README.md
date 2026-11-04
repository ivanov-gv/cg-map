# Maps for Montenegro / Kompas

Monorepo for a Montenegro map and place directory. The current product is a static, read-only PoC with local search,
place details, a satellite sample, and explicit offline download.

## Components

| Path                                                       | Responsibility                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| [apps/web](apps/web/README.md)                             | Browser experience, rendering, offline UI                               |
| [services/backend](services/backend/README.md)             | Independent Go module; optional static host and layer/transport APIs    |
| [services/transit-relay](services/transit-relay/README.md) | Public read-only live bus relay                                         |
| [data](data/README.md)                                     | Source datasets, imagery, validation, tile pipeline, reviewed artifacts |
| [packages/contracts](packages/contracts/README.md)         | Published data formats shared by producers/consumers                    |
| [platform](platform/README.md)                             | Development hosting, release infrastructure, repository checks          |
| [tests](tests/README.md)                                   | Cross-component contract and artifact integration                       |
| [docs](docs/README.md)                                     | Topic-organized architecture, feature, data, and operating guidance     |

See [team boundaries](docs/system-architecture/ownership.md) and
[current architecture](docs/system-architecture/architecture.md). Future backend/editorial capabilities are proposals,
not implemented services.

## Develop

Node 24, Python 3.12 and Go:

```sh
make setup
make dev
```

Open <http://localhost:8080/>. The web build assembles apps/web, the current data release, and compatibility assets into
ignored dist/web, and the Go backend serves it with its layers and transport APIs (server mode). `make dev-mock` serves
the same artifact statically, as GitHub Pages does (mock mode). No runtime API keys are required.

```sh
make check       # Build and validate web/data/contracts/platform
make test-e2e    # Real browser acceptance
make check-go    # Independent Go module; requires Go
```

`make build` builds the web artifact. `make build-data` deliberately regenerates geography and requires
[optional Python dependencies](docs/runbooks/data.md). Do not rebuild geography for UI changes.

## Publication

[ci-all](.github/workflows/ci-all.yml) runs only the checks a change needs, one workflow per folder, and reports one
`CI gate`. On main, [cd-pages](.github/workflows/cd-pages.yml) then deploys the verified artifact to GitHub Pages. Pull
requests never deploy, and a Markdown-only change runs no code checks.

Public URL: <https://ivanov-gv.github.io/cg-map/>. GitHub Pages source is **GitHub Actions**; no branch-folder setting
or committed deployment copy is needed.

Application code is MIT. Datasets/fonts have separate terms; satellite redistribution rights remain unverified. See
[data licensing](docs/map-data/data-license.md).
