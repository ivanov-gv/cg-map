# Platform

Ownership: platform/reliability team.

- `tools/serve.py`: local range-capable web server; serves dist/web.
- `tools/check-repo.mjs`: repository documentation, layout, and boundary checks.
- `tools/package.py`: optional source export utility.
- `hosting/`: Caddy examples for standalone artifact hosting.
- `pages/`: compatibility redirects and old-worker retirement shipped with the web artifact.
- `tests/`: HTTP transport and deployment compatibility tests.

GitHub workflows and CODEOWNERS live in `.github/`, the location required by GitHub. Platform owns their execution and permission model. Web/data owners remain responsible for their checks and build behavior.
