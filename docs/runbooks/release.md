# Web release and rollback

## GitHub Pages through Actions

Pages source is GitHub Actions. [web.yml](../../.github/workflows/web.yml) runs on main, pull requests, or manual dispatch. Backend-only changes use their separate workflow and do not redeploy web.

The web job installs pinned workspace dependencies, runs source/data/contracts/platform checks, builds dist/web, and verifies the real artifact in Chromium. On main it uploads only dist/web with upload-pages-artifact. The dependent deploy job uses configure-pages/deploy-pages and the github-pages environment. Pages/OIDC write permissions are restricted to deployment; pull requests cannot deploy.

Public URL: https://ivanov-gv.github.io/cg-map/. The app is directly at the project root. Compatibility files redirect old /web/ links and retire the earlier nested worker without clearing verified downloads.

## Local release validation

```sh
make check
make test-e2e
git diff --check
git status --short
```

Commit source, reviewed data-release changes, contracts, tests, and relevant docs. Never commit dist/ or .build/. A push to main builds and deploys a new artifact automatically; there is no root/docs deployment copy to refresh.

For another host, run make build and serve dist/web. Caddy examples are in platform/hosting. The Go host can serve that directory with its -dir option; it is independent of Pages.

## Verify and recover

Confirm the web checks and deployment succeeded. Open the project root, exercise search/selection/satellite, and verify HTTPS offline use on a target phone. CI does not establish phone performance or long-term storage retention.

To roll back, revert the offending source/data release commit on main; Actions rebuilds and redeploys it. For a workflow problem, restore the last known-good workflow first. Larger future deployments must retain old content-addressed archives for cached clients; local source rollback alone is not an archive retention service.

Official workflow guidance: [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Automatic app updates

The app checks its service-worker registration every minute while visible and online, on return to the tab, and when connectivity returns. Worker scripts and their imported release manifest bypass the HTTP cache. Installation fetches the entire replacement shell with cache reload requests before calling skipWaiting. A failed installation keeps the current worker and offline shell.

On activation, the worker claims its clients and starts navigation of open app tabs to their existing URLs, including query and fragment. Navigation is deliberately not awaited inside activation: its fetch must wait for activation to finish. This also refreshes tabs running older app code without an update listener. First installation does not reload the page. Successful updates remove obsolete shell caches, preserving the verified map archive in OPFS. Automatic reload resets in-memory selections and route endpoints.

Browser acceptance exercises a real two-release HTTP host with long-lived HTTP caching, multiple tabs, unchanged worker code with a changed imported manifest, an incomplete update, and offline reopening. Clearing browser data is not part of the release process.
