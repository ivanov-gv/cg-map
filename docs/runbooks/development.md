# Development

Requirements: Node 24, Python 3.12, and Go (for `make dev` and backend checks). Component boundaries and ownership are in [ownership](../ownership.md).

```sh
make setup
make dev
```

make setup also points git at platform/git-hooks (fast pre-commit checks; make check on pre-push). The root Makefile orchestrates component commands. npm workspaces are apps/web and data; services/backend is an independent Go module. `make dev` builds dist/web and runs the Go backend on it in server mode (layers and live transport APIs; pass `DEV_FLAGS=-live-transport=false` to avoid upstream calls). `make dev-mock` serves dist/web statically in mock mode, like GitHub Pages. Both serve generated dist/web, not repository source. Each worktree gets its own stable dev and e2e port; override with PORT or E2E_PORT. Rebuild/restart after source edits; no hot reload is configured.

```sh
make check
npx playwright install chromium
make test-e2e
make check-go
```

make check validates lint, data sources/release, docs, boundaries, the assembled web artifact, Node/Python tests, and offline manifests. make test-e2e builds the app and tests the actual artifact at / and /cg-map/. Browser artifacts are ignored locally and uploaded on CI failure.

Targeted component commands (`make verify PKG=<path>` picks the right set for the component owning a path):

```sh
npm test --workspace @cg-map/web
npm test --workspace @cg-map/data
npm run check --workspace @cg-map/data
cd services/backend && go test ./...
```

Use [the plan template](../plans/TEMPLATE.md) for multi-session work. Keep acceptance criteria, progress, decisions, and remaining work explicit. Isolate simultaneous tasks with `make worktree NAME=<branch>`; see [parallel sessions](../engineering/README.md#parallel-sessions).
