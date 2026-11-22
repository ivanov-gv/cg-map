# 0021: Packaged data tools receive contracts from the caller

## Status

Accepted.

## Context

`@ivanov-gv/map-data` first shipped only three tools. The cross-project suite imported other tools from the package, so
a release could not be tested as published. Some shipped tools resolved `packages/contracts` relative to the package
installation, a path that exists only in this repository. The published `0.1.0` cannot be changed.

## Decision

Every `data/tools` module imported by `tests/` or an app, and every module it imports locally, is included in the
package `files` and `exports`. A data test packs the package and checks that set, so an omitted tool fails validation.
Packaged tools accept a contracts directory from their caller, or a single contract path where a caller already uses
one, and fail with a message naming the missing input. They have no repository-path fallback. This rule covers contract
locations. `copyMapData` defaults to its package parent, which ships sources, artifacts and imagery; the three source
tools default to the repository root for local workflows, so package consumers pass their data root explicitly.
Contracts remain a separate repository directory until Feature #340 makes them a package.

The consumer scan lives in `tests/integration`, the one project allowed to read other projects at HEAD. The data test
reads only data's own files and asserts that every declared tool, data test import and local import is packed.

## Consequences

`make -C tests verify MAP_DATA_VERSION=<version>` can run the whole integration suite against a later published data
release. Callers must pass the contracts location explicitly, and a published package cannot borrow contracts from an
application checkout. The immutable `0.1.0` release keeps its known tool-related test failures; later versions fix the
packaging forward.
