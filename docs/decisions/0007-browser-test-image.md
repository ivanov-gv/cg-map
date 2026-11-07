# 0007: One versioned image for browser jobs and local runs

## Status

Accepted.

## Context

Every browser test job installed Chromium and its system packages. On GitHub that normally takes 14 to 25 seconds, but
slow mirrors have held it for up to 5 minutes 40 seconds. Under `act` it took 2.5 to 4 minutes per job on a bare image,
and nothing merges until local tests pass.

## Decision

- **One image does both.** platform/browser-image holds Chromium, its system packages and the tools jobs use, published
  as `ghcr.io/ivanov-gv/cg-map/browser-ci`. Browser jobs on GitHub run inside it. `make test-*` runs every local job on
  it, so another machine needs only Docker, `gh act` and a login, and no build.
- **It follows the same path as core.** A merge that changes it publishes the image tagged by commit. A tag and a
  release such as `browser-image/v1.56.1-r2` start CD, which adds that version without rebuilding. A release version
  never changes.
- **The version says what is inside:** the Playwright version, then a revision for any other change to the image.
- **It stays private.** This repository's Actions have access, so jobs pull it with their own token, and people log in.
- **Pipelines pin a release.** Moving to a new one is a PR, so a bad image cannot reach a pipeline by being merged. A
  test requires every pin to match and to name the repository's Playwright version.

## Consequences

- `1.56.1-r1` was published by hand with the owner's permission, from the PR that first uses it, because the pipeline
  that publishes it could not run before that merge. It has no tag or release. Later versions go through the pipeline.
- Upgrading Playwright takes three steps: change and release the image, then bump the repository and the pin together.
- The image is large, and every browser job on GitHub pulls it, so a normal job may gain no time there. It removes
  downloads from package mirrors during a run.
- Node in browser jobs comes from the image, not `.node-version`, so the two must move together. No check compares them.
