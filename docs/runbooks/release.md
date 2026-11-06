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

1. [ci-all](../../.github/workflows/ci-all.yml) checks what the change affects. An app it selected, once its checks
   pass, is built into an image in GHCR, tagged by commit SHA and `main`: `ghcr.io/ivanov-gv/cg-map/<app>`.
2. [ci-dev-pages](../../.github/workflows/ci-dev-pages.yml) extracts the `main` image of all three apps into one site
   and deploys it. A deploy replaces the whole site, so it always takes all three.

To put back an older build of an app, retag its image from the commit you want as `main`, then run `ci-dev-pages`.
Images are never deleted. A failed deploy does not affect `CI gate`, so check it after merging.

To run one locally: `docker run -p 8080:8080 ghcr.io/ivanov-gv/cg-map/editor:main`.

## Pull requests

A PR run waits on the `ci-approval` environment before anything runs, using no minutes while it waits. A new push
replaces the waiting run. Approve it in the run's page on GitHub, or:

```sh
gh api repos/ivanov-gv/cg-map/actions/runs/<run ID>/pending_deployments \
  -f state=approved -f comment=Ready -F "environment_ids[]=$(gh api repos/ivanov-gv/cg-map/environments/ci-approval --jq .id)"
```

`CI gate` is required, so auto-merge waits for it.

## Releasing map-core

A version is a tag and a release, in that order. Release only a commit that CI already built on main, because CD takes
the dev package CI published for that commit and changes nothing but its version.

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

## Upgrading an app to a new core

web and editor each pin an exact version, and upgrade in their own change, tested by their own pipeline:

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
