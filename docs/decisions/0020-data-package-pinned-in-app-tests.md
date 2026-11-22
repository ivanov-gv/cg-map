# 0020: Map data as a pinned package for app tests

## Status

Accepted. Implements the map-data part of the future work in [ADR 0005](0005-packages-releases-and-dev-pages.md) without
changing the independent-project rule in [ADR 0004](0004-independent-projects.md).

## Context

App tests read reviewed sources, the release archive, imagery, a place fixture, and data tools. Reading them from this
repository made every data change select all three app pipelines, even though applications consume a published release
the same way they consume map-core. A test that silently used HEAD data could also pass against data that no released
package contains.

Dev builds still need to show the data in the current commit, and release builds need to use exactly the commit they
publish. Those uses cannot be forced onto an older test pin.

## Decision

data publishes `@ivanov-gv/map-data` with the reviewed sources, artifacts, imagery, provenance, fixtures, and tools its
consumers read. Each application has one test helper that resolves the exact version pinned in its `package.json`; app
unit and browser tests read data only through that helper. A repository guard rejects a direct repository data path in
app tests and test-only tools.

Local and artifact builds use the repository `data/` and its tools together by default; app test targets set
`MAP_DATA_ROOT` to the installed package. A data-only change selects the data, tests, and HEAD-consumer pipelines, but
no app pipeline. CI publishes a dev package for the commit, and `map-data/v<version>` releases promote it through
`cd-map-data` without rebuilding. Version `0.1.0` is a one-time manual bootstrap;
[the release runbook](../runbooks/release.md#releasing-map-data) records it and the lockfile follow-up.

## Consequences

- An unreleased data change reaches an app test only when someone bumps that app's pin, so data edits no longer select
  browser suites. The pin has to be bumped deliberately after a release.
- An eventual app production release must pin every dependency, including data; no such release exists yet, so this
  records the rule without adding a release pipeline.
- The installed package and repository data must keep the same tool contract. Apps pass contract paths explicitly
  because `packages/contracts` is not shipped in the data package.
- The package carries source-specific licensing in `PROVENANCE.md`; it is not labelled MIT, which covers original
  application code only.
- A clean checkout cannot run app tests until `0.1.0` exists and the root lockfile is regenerated. The change that adds
  the pins leaves the lockfile untouched; the lead regenerates it after the publish in a separate commit. That is the
  cost of making the tests consume a real published artifact instead of a repository shortcut.
