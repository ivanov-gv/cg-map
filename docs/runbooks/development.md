# Development

Requirements: Node 24 and Python 3.12. Go is needed only for backend checks. Component boundaries and ownership are in [ownership](../ownership.md).

```sh
make setup
make dev
```

The root Makefile orchestrates component commands. npm workspaces are apps/web and data; services/backend is an independent Go module. The local server serves generated dist/web, not repository source. Set PORT for another worktree. Rebuild/restart after source edits; no hot reload is configured.

```sh
make check
npx playwright install chromium
make test-e2e
make check-go
```

make check validates lint, data sources/release, docs, boundaries, the assembled web artifact, Node/Python tests, and offline manifests. make test-e2e builds the app and tests the actual artifact at / and /cg-map/. Browser artifacts are ignored locally and uploaded on CI failure.

Targeted component commands:

```sh
npm test --workspace @cg-map/web
npm test --workspace @cg-map/data
npm run check --workspace @cg-map/data
cd services/backend && go test ./...
```

Use [the plan template](../plans/TEMPLATE.md) for multi-session work. Keep acceptance criteria, progress, decisions, and remaining work explicit. Isolate simultaneous tasks in separate worktrees/ports.
