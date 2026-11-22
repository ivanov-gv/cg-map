# 0020: Map data as a pinned package for app tests

## Status

Accepted. Implements the map-data part of the future work in [ADR 0005](0005-packages-releases-and-dev-pages.md) without
changing the independent-project rule in [ADR 0004](0004-independent-projects.md).

## Context

App tests read reviewed sources, the release archive, imagery, a place fixture, and data tools. Reading them from this
repository made every data change select all three app pipelines, even though applications consume a published release
the same way they consume map-core. A test that silently used HEAD data could also pass against data that no released
package contains.

Dev builds on main still need to show the data in the current commit. A future app production release pins every
dependency, data included; no app production release exists yet. Those uses cannot share an older test pin.

## Decision

A project's tests read only its own files or an exact published version of another project, never another project's
HEAD. A change in one project never requires test changes in another. Here that means an exact `@ivanov-gv/map-data`
release. The scoped exception is `tests/`, the cross-project integration project, which tests HEAD contracts by design.

data publishes `@ivanov-gv/map-data` with the reviewed sources, artifacts, imagery, provenance, fixtures, and tools its
consumers read. Each application has one test helper that resolves the exact version pinned in its `package.json`; app
unit and browser tests read data only through that helper. A repository guard rejects a direct repository data path in
app tests and test-only tools.

Dev and CI artifact builds on main use the repository `data/` and its tools together; app and platform test targets set
`MAP_DATA_ROOT` to the installed package. A data-only change selects the data and integration-test pipelines only. CI
publishes a dev package for the commit, and `map-data/v<version>` releases promote it through `cd-map-data` without
rebuilding. Version `0.1.0` is a one-time manual bootstrap;
[the release runbook](../runbooks/release.md#releasing-map-data) records it. A pin bump changes `package-lock.json` and,
as with a map-core pin bump, selects every pipeline.

## Consequences

- An unreleased data change reaches an app test only when someone bumps that app's pin, so data edits no longer select
  browser suites. The pin has to be bumped deliberately after a release.
- An eventual app production release must pin every dependency, including data; no such release exists yet, so this
  records the rule without adding a release pipeline.
- The installed package and repository data must keep the same tool contract. Apps pass contract paths explicitly
  because `packages/contracts` is not shipped in the data package.
- The package carries source-specific licensing in `PROVENANCE.md`; it is not labelled MIT, which covers original
  application code only.
- The pins need a version that already exists, so `0.1.0` was published once by hand from commit `51a8feb` of
  `feature/337-data-package`; its data content is identical to main `0a74bd8`. Installing dependencies needs a GitHub
  Packages token, as it already does for map-core. That is the cost of making the tests consume a real published
  artifact instead of a repository shortcut.

## Outcome note (2026-11-22)

The owner refined the scoped `tests/` exception without changing the app and platform pin rule above. Cross-project
integration tests still read HEAD data by default through one helper, but a data release must be tested against the
exact version being promoted. `make -C tests verify MAP_DATA_VERSION=<version>` installs that registry package, sets
`MAP_DATA_ROOT` through the same helper and builds the web artifact from it. The repository check permits a direct
repository data path only in that helper. Current guidance is in
[the architecture rules](../system-architecture/architecture.md#independent-projects) and
[the release runbook](../runbooks/release.md#releasing-map-data).

## Outcome note: packaged tools (2026-11-22)

`0.1.0` shipped only three tools, so `tests/` could not test a release as published, and some tools resolved
`packages/contracts` by a path that exists only in this repository. Every `data/tools` module that `tests/` or an app
imports, with its local imports, is now in the package `files` and `exports`. A data test packs the package and fails on
an omitted tool. Packaged tools take the contracts location from their caller and fail with a message naming the missing
input; they have no repository-path fallback. `copyMapData` defaults to its package parent, which ships sources,
artifacts and imagery. The three source tools default to the repository root for local workflows, so package consumers
pass their data root explicitly. The consumer scan lives in `tests/integration`, the one project allowed to read other
projects at HEAD. The immutable `0.1.0` keeps its known tool-related test failures; later versions fix the packaging
forward. Contracts stay a repository directory until Feature #340 publishes them as a package.
