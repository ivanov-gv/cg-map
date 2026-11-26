# 0046: Editor builds take map-core from their own commit

## Status

Accepted. Partially supersedes the app-core rule in [ADR 0005](0005-packages-releases-and-dev-pages.md) for apps/editor
only; apps/web still consumes a pinned core. Implements step 1 of #424.

## Context

The owner (2026-11-26): dev GitHub Pages is a preview of everything currently on main. Data and contracts already reach
editor dev builds from the checked-out commit, while map-core still came from the released package the app pins.
Unmerged core work therefore could not be seen in the editor's dev or Pages artifact.

## Decision

- Every editor build that is not a release (`build`, `dev`, `lan`, CI artifacts and the dev Pages site) bundles
  `packages/map-core` at HEAD. One resolver, `tools/core-root.mjs`, defaults there and honours `MAP_CORE_ROOT`.
- `make -C apps/editor build-release` bundles the exact `@ivanov-gv/map-core` pinned in `package.json`, resolved through
  `tests/pinned-core.mjs`, and refuses another core root. It pins data and contracts the same way.
- Automated editor tests, including browser tests, keep their pins. Test targets and the browser config set all three
  roots from the app's own helpers; a core change cannot alter a test without an intentional pin bump.

## Consequences

A core mistake now reaches the editor dev artifact with its merge, as data and contract mistakes already do; tests do
not follow it until a pin bump. Editor code must work with both its pinned core and the one beside it. Release builds
and web are unchanged here, and selecting editor pipelines when core changes belongs to a later step of #424.
