# Release and rollback

## GitHub Pages migration

The repository now prepares branch-based Pages output at the root. After merging/pushing this change, set **Settings → Pages → Deploy from a branch → main → / (root)**. The repository settings are changed by the owner separately.

`docs/` now contains Markdown documentation. Until the Pages setting changes, the former `/docs` source will no longer serve the map. Public URL remains https://ivanov-gv.github.io/cg-map/.

## Prepare and verify

```sh
make pages
make check
make test-e2e
git diff --check
git status --short
```

`make pages` refreshes offline manifests and copies runtime assets from `web/` into managed root paths. The publisher excludes Markdown and instructions, records outputs in `.pages-manifest.json`, and only removes obsolete entries in that inventory. It never mirrors over or deletes the repository root or docs directory.

Review and commit the source, generated output, inventory, and relevant documentation together. `make check` fails on stale root copies. CI does not regenerate output to conceal drift.

For other hosts, `npm run build:static` creates an untracked `dist/` copy of `web/`. Optional Python/Go hosts continue serving `web/`, avoiding exposure of repository documentation and build files in local hosting.

## Verify deployment

- Confirm the GitHub checks and Pages deployment succeeded.
- Open the public project URL, toggle satellite, search, and select a place.
- Confirm archive responses support ranges or the documented full-response fallback.
- Verify HTTPS offline download/reload on a target phone; CI is not phone performance evidence.

## Rollback

Revert the release commit on main and let Pages redeploy. For the migration commit itself, restoring the old `/docs` layout also requires restoring the Pages folder setting.

Future larger deployments must retain old content-addressed archives for an explicit compatibility window: clients with cached older shells may still request them. Root publishing currently removes obsolete local managed files; it is not a production archive retention service.
