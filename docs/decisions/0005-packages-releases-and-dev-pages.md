# 0005: Versioned packages, releases and Pages as the dev environment

## Status

Accepted.

## Context

Many agents contribute in parallel, faster than they communicate. When every app runs the shared map runtime from the
same commit, one mistake in core breaks every app at once, and a release of one part drags along the others. The project
has no users yet, so the process can be set up properly before it has to protect anyone.

## Decision

- **core is a package.** packages/map-core publishes as `@ivanov-gv/map-core` to GitHub Packages. apps/web and
  apps/editor pin an exact release and upgrade in their own change. apps/core-demo uses local core: it is core's dev
  environment.
- **A version is a release.** Create a tag, then a GitHub Release for it, such as `map-core/v0.2.0`. Only the release
  triggers CD, which publishes that version. A prerelease publishes under `next`, anything else under `latest`. CD never
  rebuilds: it takes the package CI built for that commit and changes only its version.
- **Pages is the dev environment.** Every merge to main updates it, as a CI step without tags or releases:
  `/core-demo/`, `/editor/` and `/web/`, with a chooser at the root. There are no pre or prod environments yet.
- **Artifacts are images.** CI builds each app into an image in GHCR, tagged by commit SHA and `main`. The Pages step
  takes the `main` image of all three, because a deploy replaces the whole site.
- **PR checks wait for approval.** A PR run starts by waiting on the `ci-approval` environment. The owner or the bot
  approves it. A waiting job uses no minutes, and a new push replaces the waiting run. `CI gate` stays required.

These replace the earlier exceptions that deployed Pages on every merge through CD and ran PR checks automatically.

## Consequences

- A bad core merge can only break `/core-demo/`. Apps keep their pinned release until they choose to upgrade.
- Installing dependencies needs a token even though the package is public: GitHub Packages requires one for npm.
- Pages cannot publish anywhere but this repository, so its final deploy step has no test-run twin.
- Apps can fall behind core, and each upgrade is a change. That is the point: it makes each upgrade a decision.

## Future

- Move to pnpm. npm cannot install a package from a subfolder of a repository, so getting unreleased core from VCS
  outside this repository needs pnpm's `#path:` support.
- Package contracts and map data the same way. Both are still read from this repository.
