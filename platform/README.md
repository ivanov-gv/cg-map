# Platform

Ownership: platform/reliability team.

- `tools/serve.py`: local range-capable web server; serves dist/web.
- `tools/check-repo.mjs`: repository documentation, layout, and boundary checks.
- `tools/package.py`: optional source export utility.
- `tools/verify.mjs`: `make verify PKG=<path>` dispatch to the owning component's checks.
- `tools/dev-port.mjs`, `tools/worktree.sh`: per-worktree ports and isolated checkouts for parallel sessions.
- `agents/`: agent harness. `guidelines.json` maps docs/engineering to adapters; `gen-agent-rules.mjs` generates them. There are no agent hooks; the compliance reviewer comes from the personal agents plugin. See [engineering guidelines](../docs/engineering/README.md).
- `git-hooks/`: pre-commit and pre-push backstops, enabled by `make setup`.
- `hosting/`: Caddy examples for standalone artifact hosting.
- `pages/`: compatibility redirects and old-worker retirement shipped with the web artifact.
- `tests/`: HTTP transport and deployment compatibility tests.

GitHub workflows and CODEOWNERS live in `.github/`, the location required by GitHub. Platform owns their execution and permission model. Web/data owners remain responsible for their checks and build behavior.
