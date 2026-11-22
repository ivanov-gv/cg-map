# 0021: Shared contracts as a versioned package

## Status

Accepted. Implements the contracts part of the future work in [ADR 0005](0005-packages-releases-and-dev-pages.md)
without changing the independent-project rule in [ADR 0004](0004-independent-projects.md) or the pin rule in
[ADR 0020](0020-data-package-pinned-in-app-tests.md).

## Context

Schemas, fixtures, editor rules and proto files lived in `packages/contracts`, but every consumer read that directory by
relative path. A contract edit therefore selected app pipelines even though applications can only consume a released
format. A test could pass against unpublished HEAD while its installed dependencies used the previous format, and a
producer could change a format without testing the exact artifact a release would promote. Those reads also bypassed the
boundary that map-core, map-data and the applications already cross through exact published versions.

The independent-project rule says a project's tests read only its own files or an exact published version of another
project. Data validation must still check reviewed sources against the contracts in the same commit, and the
cross-project `tests/` project exists to check components at HEAD. Those two uses need a narrow, visible exception.

## Decision

`packages/contracts` publishes `@ivanov-gv/map-contracts` as a GitHub Package. It ships schemas, `editor-layers.json`,
`place-visibility.json`, fixtures, proto files, `package.json`, README and license. Consumers import files by package
path and hold an exact `0.1.0` pin: map-core as a development dependency, every map application, and services/backend
through the root manifest. No runtime code imports the package.

The repository manifest stays `0.0.0-dev` and the folder is not an npm workspace, so a relative read can never satisfy a
consumer's pin. A repository check rejects relative contract paths outside `packages/contracts`, except data validation
and the one cross-project helper. Data reads HEAD contracts directly. `tests/contracts-root.mjs` is the only place
integration tests resolve a contracts root; it defaults to HEAD and honours `MAP_CONTRACTS_ROOT`. A release run sets
`MAP_CONTRACTS_VERSION`, which installs and tests the exact package being promoted through that same helper.

A contract-only change selects the contracts, data, tests and platform pipelines; no browser suite is selected. CI
publishes a dev package for the change, and a `map-contracts/v<version>` release promotes it without rebuilding, as
[the release runbook](../runbooks/release.md#releasing-map-contracts) describes.

## Consequences

- A contract change reaches an app only after someone publishes a release and bumps its pin deliberately. App tests no
  longer run for a schema-only change, while data and integration tests still check the producer and consumer together.
- The package contains format files rather than implementation helpers. Breaking changes need a version bump and
  coordinated producer and consumer review; the exports are the supported surface.
- Data and `tests/` deliberately read HEAD, so schema-only failures appear there rather than in app tests. The helper
  and guard keep that exception to the two places whose job it is to check HEAD.
- `0.1.0` is a one-time manual bootstrap: the pinned consumers must exist before CI can plan and publish a contracts
  release. The change leaves `package-lock.json` untouched, and the lead regenerates it after the version exists.
- GitHub Packages requires a token for installation, as it already does for map-core and map-data. Published versions
  are immutable; fixes go forward in a new version.

Current guidance is in [system architecture](../system-architecture/architecture.md#contract-modes),
[ownership](../system-architecture/ownership.md) and
[the release runbook](../runbooks/release.md#releasing-map-contracts).
