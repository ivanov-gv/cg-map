# Cross-component integration

- integration/: archive/rendering/data contracts and transport behavior across component boundaries.
- Browser acceptance lives with each browser project, against its own artifact at origin root and project prefix. See
  [web testing](../apps/web/AGENTS.md#testing).

Component-specific tests live with their components. `make verify PKG=tests` from the root is optional for iterating;
the pre-push hook's `make check` is required (builds and non-browser checks, no browser suites). GitHub's tests pipeline
and `CI gate` are the merge gate. Browser tests do not establish phone GPU performance or long-term storage retention.

## Data version

[data-root.mjs](data-root.mjs) is the only data path resolver in this project. It reads repository `data/` at HEAD by
default, so a data change selects this pipeline. It also honours `MAP_DATA_ROOT`, which is how a release run points
every test and the web build at one data root.

Test HEAD data:

```sh
make verify PKG=tests
```

Test an exact published package instead:

```sh
make -C tests verify MAP_DATA_VERSION=0.1.0
```

That target installs `@ivanov-gv/map-data@<version>` from GitHub Packages into `tests/node_modules`, resolves it through
the same helper and exports `MAP_DATA_ROOT` to lint, build and integration steps. It needs a GitHub Packages token; the
Makefile uses `NODE_AUTH_TOKEN` or `gh auth token`. HEAD-only contracts may fail against an older package; those
failures are real findings, not tests to skip or loosen. See
[releasing map data](../docs/runbooks/release.md#releasing-map-data).

## Contracts version

[contracts-root.mjs](contracts-root.mjs) is the only contract path resolver here. It reads repository
`packages/contracts` at HEAD by default and honours `MAP_CONTRACTS_ROOT`, which is how a release run points every test
and the web build at one package root.

```sh
make -C tests verify MAP_CONTRACTS_VERSION=0.1.0
```

That installs `@ivanov-gv/map-contracts@<version>` from GitHub Packages into `tests/node_modules`, resolves it through
the same helper and exports `MAP_CONTRACTS_ROOT` to lint, build and integration steps. It uses the same token as the
data install and can be combined with `MAP_DATA_VERSION` to test both releases together. Data validation still reads
HEAD contracts by default. The Go module keeps a local copy of the direction fixture so its tests need no npm; this
suite checks that copy byte-for-byte against the pin. See
[releasing map contracts](../docs/runbooks/release.md#releasing-map-contracts).
