# Dev environment and releases

Decision: [ADR 0005](../decisions/0005-packages-releases-and-dev-pages.md). In short, merging shows work on the dev
environment, and only a release creates a version.

## Dev environment

GitHub Pages is the dev environment, and there are no pre or prod environments yet:
<https://ivanov-gv.github.io/cg-map/>

| Path          | Shows                                               |
| ------------- | --------------------------------------------------- |
| `/`           | A page to choose from                               |
| `/web/`       | The public map                                      |
| `/editor/`    | The layer editor, installable from here             |
| `/core-demo/` | Unreleased map-core: this is core's dev environment |

Every merge to main updates it, with no tags or releases:

1. A push to main starts [ci-publish](../../.github/workflows/ci-publish.yml), which builds each app the change affects
   into an image in GHCR, tagged by commit SHA and `main`: `ghcr.io/ivanov-gv/cg-map/<app>`. It runs no tests, because
   the PR run already tested this content. The nightly run of [ci-nightly](../../.github/workflows/ci-nightly.yml) tests
   main.
2. The `pages` job in ci-publish builds the dev site from source (all three apps) and pushes the image
   `$IMAGE_REPOSITORY/dev-pages:<sha>`. When ci-publish completes successfully on main,
   [cd-dev-pages](../../.github/workflows/cd-dev-pages.yml) is triggered via `workflow_run` — it pulls the image by
   commit SHA, extracts the site, and deploys. CD only runs for a successful push build on main, never for a CI test run
   or any other run. A deploy replaces the whole site, so it always takes all three.

To put back an older build, dispatch cd-dev-pages with the commit to roll back to (within the last 10 builds — the
rollback window). A failed deploy does not affect `CI gate`, so check it after merging. To republish after a failed
merge run, use "Re-run failed jobs" on that run.

To manually deploy a specific commit (rollback or promotion), dispatch cd-dev-pages with that commit:

```sh
gh workflow run cd-dev-pages.yml --ref main -f test_run=false -f commit=<full SHA on main>
```

The commit must be on main and have a `dev-pages:<commit>` image that has not been cleaned up (ci-publish keeps the last
10 versions — the rollback window). After an image is cleaned up, rebuild it first with ci-publish's `commit` input,
then dispatch cd-dev-pages. Every commit deploys its own version; an older push does not overwrite a newer site. Find a
qualifying commit with
`gh run list --workflow ci-publish.yml --branch main --status success --json headSha --jq '.[0].headSha'`.

To run one locally: `docker run -p 8080:8080 ghcr.io/ivanov-gv/cg-map/editor:main`.

## Pull requests

A PR run starts with the `ci-approval` environment gate, which passes automatically until the owner adds required
reviewers; adding a reviewer later needs no workflow change. While the gate waits, it uses no minutes, and a new push
replaces the waiting run. To approve a run that requires approval, use the run's page on GitHub, or:

```sh
gh api repos/ivanov-gv/cg-map/actions/runs/<run ID>/pending_deployments \
  -f state=approved -f comment=Ready -F "environment_ids[]=$(gh api repos/ivanov-gv/cg-map/environments/ci-approval --jq .id)"
```

`CI gate` is required, so auto-merge waits for it.

## Releasing map-core

A version is a tag and a release, in that order. Release only a commit on main whose CI run selected map-core: CD takes
the dev package CI published for that commit, changes nothing but its version, and refuses a commit that is not on main.

```sh
git tag map-core/v0.2.0 <commit on main>
git push origin map-core/v0.2.0
gh release create map-core/v0.2.0 --verify-tag --generate-notes
```

The release starts [cd-map-core](../../.github/workflows/cd-map-core.yml). A push of the tag alone starts nothing. Use a
prerelease for a release candidate: `map-core/v0.2.0-rc.1` with `--prerelease` publishes under `next`, so a plain
install can never get it. A final version publishes under `latest`. A published version cannot be changed: fix forward
with a new one.

`0.1.0` is the one exception: it was published by hand once, because releases need core to exist before apps can pin it.

## Releasing map-data

Release only a commit on main whose CI run selected data: a merge that changes data publishes `@ivanov-gv/map-data` as
`0.0.0-dev.<commit>` under the `dev` tag when ci-publish's plan selects data. A versioned release promotes that dev
package without rebuilding:

```sh
git tag map-data/v0.1.0 <commit on main>
git push origin map-data/v0.1.0
gh release create map-data/v0.1.0 --verify-tag --generate-notes
```

The release starts [cd-map-data](../../.github/workflows/cd-map-data.yml). A tag push alone starts nothing. Use a
prerelease such as `map-data/v0.2.0-rc.1` with `--prerelease` to publish under `next`; a final version publishes under
`latest`. A published version cannot be changed: fix forward with a new one. The commit must be on main.

`0.1.0` is the one exception: its package was built from commit `51a8feb` of `feature/337-data-package`, its data
content is identical to main `0a74bd8`, and the lead published it on 2026-11-22. It has no tag and started no CD.

App and platform hosting tests read only that pinned package, so a data-only change selects no app or platform pipeline.
Each application bumps its own pin in its own change, as map-core upgrades do; a pin bump changes `package-lock.json`
and therefore selects every pipeline. The three-app command is only an optional example:

```sh
npm install --workspace apps/web --workspace apps/editor --workspace apps/core-demo \
  --save-exact @ivanov-gv/map-data@0.2.0
```

## Releasing the browser image

[platform/browser-image](../../platform/browser-image/Dockerfile) holds the tools for browser jobs and local runs:
[the decision](../decisions/0007-browser-test-image.md). A merge that changes it publishes
`ghcr.io/ivanov-gv/cg-map/browser-ci:<commit>`. To release it, use the Playwright version it contains, then the next
revision:

```sh
git tag browser-image/v1.56.1-r2 <commit on main>
git push origin browser-image/v1.56.1-r2
gh release create browser-image/v1.56.1-r2 --verify-tag --title "browser-image 1.56.1-r2" --notes "<what changed>"
```

The release starts [cd-browser-image](../../.github/workflows/cd-browser-image.yml), which refuses a version that does
not match the image's Playwright, or one that already exists. To start using it, change the pin in the Makefile and the
browser jobs in one PR.

## Upgrading an app to a new core

web and editor each pin an exact version, and upgrade in their own change. That changes package-lock.json, so its PR
runs every pipeline:

```sh
npm install --workspace apps/editor --save-exact @ivanov-gv/map-core@0.2.0
```

To try a release candidate, do the same with its version in a branch. A bad core merge cannot reach these apps: going
back means pinning the older version.

## Offline app updates

The web app checks its service-worker registration once when the page loads or reloads. It schedules no background
polling and does not check on tab focus or connectivity changes. Worker scripts and their imported release manifest
bypass the HTTP cache. Installation fetches the entire replacement shell with cache reload requests before calling
skipWaiting. A failed installation keeps the current worker and offline shell.

On activation, the worker claims its clients and starts navigation of open app tabs to their existing URLs, including
query and fragment. Navigation is deliberately not awaited inside activation: its fetch must wait for activation to
finish. First installation does not reload the page. Successful updates remove obsolete shell caches, preserving the
verified map archive in OPFS. Automatic reload resets in-memory selections and route endpoints.

Browser acceptance exercises a real two-release HTTP host with long-lived HTTP caching, multiple tabs, unchanged worker
code with a changed imported manifest, an incomplete update, and offline reopening. The editor's own updates are
described in [its README](../../apps/editor/README.md#offline-and-updates).

## Another host

Any image above serves its app on port 8080. Caddy examples are in platform/hosting. The Go host can serve dist/web with
its -dir option; it is independent of Pages.

## Devices that used the old site

The web app used to live at the root, and a browser that visited it keeps that worker, which can answer for every path
under `/cg-map/`. If `/editor/` or `/web/` shows an old page on such a device, clear the site's data. That also removes
editor drafts on this origin, so export them first.
