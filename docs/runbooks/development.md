# Development

Requirements: Node 24 (exact local reference in `.node-version`) and Python 3.12. The included snapshot runs without npm or Python third-party packages; checks need npm dependencies.

```sh
make setup
make dev
```

Open http://localhost:8080/. Set `PORT=8081 make dev` for another worktree. No hot reload is configured.

```sh
make check
npx playwright install chromium
make test-e2e
```

`make check` runs ESLint, structural data/provenance checks, documentation links, module boundaries, Node/Python tests, Python compilation, and generated Pages parity. It does not modify generated files. If runtime assets changed, first run `make pages`.

Playwright starts its own server at an available localhost port and tests both origin-root and project-prefix paths. Use `E2E_PORT` to isolate simultaneous runs. Browser artifacts are ignored by Git and uploaded on CI failure.

Go is optional locally; `make check-go` runs vet/tests/build when installed. CI checks the optional host independently.

For complex work, copy [the plan template](../plans/TEMPLATE.md) into a task-specific file. Keep acceptance criteria, decisions, progress, and remaining steps there. Small changes need only a clear issue/PR. Avoid parallel edits in one checkout.
