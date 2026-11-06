# Web release and rollback

## GitHub Pages through Actions

Pages source is GitHub Actions. CI and deployment are separate workflows, joined only by an artifact.
[ci-all](../../.github/workflows/ci-all.yml) runs on pull requests, on main, nightly, and by manual dispatch, and
selects the folders a change affects. Changes that do not affect the web do not redeploy it.

[ci-apps-web](../../.github/workflows/ci-apps-web.yml) installs pinned workspace dependencies, verifies the web
component, builds dist/web, uploads it as `web-artifact`, and tests that artifact in Chromium. On main every browser
area runs whenever the web artifact is built. When ci-all succeeds on a push to main,
[cd-pages](../../.github/workflows/cd-pages.yml) downloads that artifact without checking out the application, and
publishes it with deploy-pages and the github-pages environment. Pages/OIDC write permissions exist only in cd-pages;
pull requests cannot deploy.

Public URL: <https://ivanov-gv.github.io/cg-map/>. The app is directly at the project root. Compatibility files redirect
old /web/ links and retire the earlier nested worker without clearing verified downloads.

## Local release validation

```sh
make check
make -C apps/web e2e
git diff --check
git status --short
```

Commit source, reviewed data-release changes, contracts, tests, and relevant docs. Never commit dist/ or .build/. A push
to main that affects the web builds and deploys a new artifact automatically; there is no root/docs deployment copy to
refresh.

For another host, run make -C apps/web build and serve dist/web. Caddy examples are in platform/hosting. The Go host can
serve that directory with its -dir option; it is independent of Pages.

## Verify and recover

Confirm ci-all and cd-pages succeeded. A failed cd-pages does not affect `CI gate` or show on the pull request, so check
it after merging. Open the project root, exercise search/selection/satellite, and verify HTTPS offline use on a target
phone. CI does not establish phone performance or long-term storage retention.

To roll back within 30 days, publish an earlier verified artifact, choosing the ci-all run of a push to main:
`gh workflow run cd-pages.yml -f test_run=false -f run_id=<run ID>`. Otherwise, or to keep the fix in history, revert
the offending source/data release commit on main; Actions rebuilds and redeploys it. For a workflow problem, restore the
last known-good workflow first. Larger future deployments must retain old content-addressed archives for cached clients;
local source rollback alone is not an archive retention service.

Official workflow guidance:
[GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Automatic app updates

The app checks its service-worker registration once when the page loads or reloads. It schedules no background polling
and does not check on tab focus or connectivity changes. Worker scripts and their imported release manifest bypass the
HTTP cache. Installation fetches the entire replacement shell with cache reload requests before calling skipWaiting. A
failed installation keeps the current worker and offline shell.

On activation, the worker claims its clients and starts navigation of open app tabs to their existing URLs, including
query and fragment. Navigation is deliberately not awaited inside activation: its fetch must wait for activation to
finish. This also refreshes tabs running older app code without an update listener. First installation does not reload
the page. Successful updates remove obsolete shell caches, preserving the verified map archive in OPFS. Automatic reload
resets in-memory selections and route endpoints.

Browser acceptance exercises a real two-release HTTP host with long-lived HTTP caching, multiple tabs, unchanged worker
code with a changed imported manifest, an incomplete update, and offline reopening. Clearing browser data is not part of
the release process.
