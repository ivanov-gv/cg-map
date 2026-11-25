# 0037: Builds take the packages of their own commit, and releases pin them

## Status

Accepted. Implements #424, part of #156. Replaces the part of [ADR 0005](0005-packages-releases-and-dev-pages.md) that
keeps unreleased core out of the dev builds of apps/web and apps/editor, and the part of
[ADR 0021](0021-shared-contracts-as-a-versioned-package.md) that generates the services/backend bindings from a pinned
release. The pins of automated tests in ADR 0020 and 0021 stay as they are.

## Context

The owner (2026-11-25): builds that are not releases, such as main on dev or any commit under test, use the core, data
and contracts of the same commit; releases use exact releases of them; for every project. Data and contracts already
worked that way. apps/web and apps/editor still bundled the released map-core on dev, so six merged core Features could
not be seen there.

## Decision

- **A build that is not a release bundles core, data and contracts from its own commit.** That is every `build`, `dev`,
  `lan`, CI image and the dev site. Each app has one resolver per package, which defaults to the repository folder; for
  core it is `tools/core-root.mjs` and `MAP_CORE_ROOT`.
- **A release build pins all of them:** `make -C apps/<name> build-release` takes the exact versions in the app's
  package.json, which the pin tests keep exact, released and from the registry. No app release exists yet.
- **Automated tests keep their pins** (the owner's rule of 2026-11-22), so they test what a release ships and a change
  of one package never rewrites another project's tests. `tests/` builds web and the editor from the commit.
- **What a dev build bundles rebuilds it.** A change to core, data or contracts publishes the image of every app, and a
  core change also runs `tests/`.
- **The backend generates its bindings from the proto of its own commit,** and a release from the contracts it pins.

## Consequences

A core mistake now reaches the dev site with its merge, as data and contract mistakes already do; `tests/` catches what
breaks a build, and nothing automatic checks how an app looks with a core it has not pinned yet. It still cannot reach a
release. App code must work with both its pinned core and the one beside it, as it already must for data and contracts.
Bindings are committed; the backend check refuses ones that differ from the proto of their commit. Data changes publish
three images instead of none.
