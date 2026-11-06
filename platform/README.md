# Platform

Ownership: platform/reliability team.

- `tools/serve.py`: local range-capable web server; defaults to dist/web; `--app` serves another project's artifact and
  `--path-prefix` also serves it under a URL prefix.
- `tools/check-repo.mjs`: repository documentation, layout, and boundary checks.
- `tools/verify.mjs`: `make verify PKG=<path>` dispatch to the owning component's checks.
- `tools/format-markdown.mjs`: fix authored Markdown with markdownlint/Prettier and regenerate agent rules; see
  [Markdown checks](../docs/runbooks/development.md#markdown-checks-and-formatting).
- `tools/dev-port.mjs`, `tools/worktree.sh`: per-worktree ports and isolated checkouts for parallel sessions.
- `agents/`: agent harness. `guidelines.json` maps docs/engineering to `.claude/rules`; `gen-agent-rules.mjs` generates
  them. There are no agent hooks; the compliance reviewer comes from the personal agents plugin. See
  [engineering guidelines](../docs/engineering/README.md).
- `git-hooks/`: pre-commit and pre-push backstops, enabled by `make setup`. Pre-commit rejects commits in the main
  checkout (`tools/require-worktree.sh`).
- `hosting/`: Caddy examples for standalone artifact hosting.
- `pages/`: compatibility redirects and old-worker retirement shipped with the web artifact.
- `tests/`: HTTP transport, deployment compatibility, agent harness, git hooks, and Markdown tooling tests.

GitHub workflows and CODEOWNERS live in `.github/`, the location required by GitHub. Platform owns their execution and
permission model. Web/data owners remain responsible for their checks and build behavior.
