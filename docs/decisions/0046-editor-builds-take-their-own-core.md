# 0046: Editor builds take map-core from their own commit

## Status

Accepted. Partially supersedes the app-core rule in [ADR 0005](0005-packages-releases-and-dev-pages.md) for apps/editor
and, from the outcome below, apps/web. Implements steps 1 and 2 of #424.

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

## Outcome: Web follows the same split (2026-11-27, #424)

Web applies the same decision through its own `tools/core-root.mjs`: plain `build`, `dev`, `dev-mock` and the ci-publish
image/Pages builds take map-core, data and contracts from the checked-out commit. Verification targets and
`make -C apps/web build-release`, which the existing `npm run release:prepare` delegates to, take the exact pins in
`apps/web/package.json` and refuse any other core, data or contracts root. Platform's hosting test calls Web's
`build-pinned-core` target with its own data and contracts pins, so it uses Web's core pin without becoming a release.
Automated Web tests keep reading the pins, so a package change cannot change a test without an intentional bump. The
reason is unchanged — the dev stand previews main, while a release ships exactly what the project pins — so this needs
no new decision record. Selecting consumer pipelines when a producer changes remains a later step of #424.

## Outcome: Core Demo follows the same split (2026-11-27, #424)

Core-demo takes map-core from `packages/map-core` by path in plain `build`, `dev`, ci-publish image/Pages builds, while
`make verify`, its test targets and `make -C apps/core-demo build-release` resolve the pin in `package.json` through
`tests/pinned-core.mjs`. Its release refuses a substituted core, data or contracts root; data and contracts keep their
existing HEAD default outside tests and releases. Core-demo pins workspace `0.0.0-dev` because it is core's dev
environment, so the pin and the repository path name the same core until a release is published — the explicit pin path
still makes the release declaration checkable. Automated tests keep reading pins, and the reason is the same as for
Editor and Web, so this needs no new decision record.

## Outcome: Backend splits contracts generation the same way (2026-11-27, #424)

services/backend uses no map-core or map-data package. Its dev `make generate` reads this commit's contracts through its
own `tools/contracts-root.sh` and honours `MAP_CONTRACTS_ROOT`; `generate-check`, `generate-release` and `build-release`
resolve the exact `@ivanov-gv/map-contracts` pin and refuse another root. Regular Go builds and tests compile committed
bindings and use a fixture copy that `tests/` verifies against its pin, so they need no installed package. CI's backend
check does not call `generate-check`, so automatic pin enforcement would require installing the pin there; that is
outside this change. The dev stand and release reasons are unchanged, so this needs no new decision record.

## Outcome: Transit relay has no package to split (2026-11-27, #424)

services/transit-relay's `relay.mjs` and `worker.mjs` import only each other; its tests use local fixtures, its Makefile
only lints and runs those tests, and the hosted deployment is a recorded manual copy of `relay.mjs`. It resolves no
map-core, map-data or map-contracts package, path, embed or generated code in dev, CI or tests, so it already follows
the rule without a code change.
