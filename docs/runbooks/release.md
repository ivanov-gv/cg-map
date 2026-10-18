# Release and rollback

## GitHub Pages

Use **Settings → Pages → Deploy from a branch → main → / (root)**. The public entry remains https://ivanov-gv.github.io/cg-map/ and opens the app at `/cg-map/web/`.

There is one application tree: `web/`. Root `index.html` forwards there while preserving query/hash. Root `.nojekyll` disables Jekyll processing. `docs/` contains documentation, not deployable app copies.

Root `sw.js` is a migration shim for browsers that previously registered a worker at the project root. It unregisters that worker without deleting shared caches or verified OPFS downloads. The current application registers `web/sw.js` within `web/`.

## Prepare and verify

```sh
make pages
make check
make test-e2e
git diff --check
git status --short
```

`make pages` refreshes offline manifests in web/. It never copies application files into the repository root. Review and commit relevant source, manifests, tests, and docs together. CI checks the layout and offline manifest freshness without silently rebuilding them.

For standalone hosting, `npm run build:static` creates an ignored `dist/` containing only runtime assets. Serve that directory directly. The Python host (`tools/serve.py`) serves web/ locally; the optional Go command (`cmd/kompas/`) serves an asset directory selected with `-dir`.

## Verify deployment

- Confirm checks and Pages deployment succeeded.
- Open the root project URL; confirm it reaches the app, then toggle satellite, search, and select a place.
- Confirm archive range reads or the documented full-response fallback.
- Verify HTTPS offline download/reload on a target phone; CI is not phone performance evidence.

## Rollback

Revert the release commit and let Pages redeploy. The Pages source remains main / (root). Reverting all the way to the earlier /docs layout also requires restoring that folder setting.

Future larger releases must retain old content-addressed archives for a compatibility window: clients with cached shells may still request them. Local finalization is not a production archive retention service.
