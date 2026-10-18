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
