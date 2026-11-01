# Backend module

Read [README.md](README.md). Run Go commands from services/backend or use make check-go at the repository root. This module must remain independently buildable without npm or raw geography. The server serves an explicitly selected artifact directory and the PMTiles archive inside it (or one passed with -archive); it does not embed web source. API formats follow packages/contracts: the vehicles endpoint keeps services/transit-relay's normalization, cache and headers, plus the optional movement `bearing`/`heading` the relay does not produce. Keep direction.go in step with apps/web/src/vehicle-direction.js; both run packages/contracts/fixtures/vehicle-direction-cases.json. Tests never call the live upstream.

<!-- BEGIN GENERATED agent-guidelines: edit docs/engineering/*.md and run `make agent-rules` -->
<!-- agent-guideline: go sha256:bad2fd7ae3a9 -->
## Go conventions (from ../../docs/engineering/go.md)

Applies to `*.go`, `go.mod`, and `go.work`. Today this is the services/backend module only.

### Module boundaries

- services/backend is an independent module. It builds and tests without npm, Node, or raw geography. Enforced: `make check-go` and the backend CI workflow.
- The server serves an explicitly selected artifact directory. It does not embed or read web source, data/sources, or pipeline output paths directly.
- Do not scaffold placeholder services, APIs, or packages for future editorial work (see [ownership](../../docs/ownership.md)).

### Code

- Format with `gofmt`. Enforced: the git pre-commit hook and `make check-go` (`gofmt -l`).
- `go vet ./...` must pass. Enforced: `make check-go`.
- Prefer the standard library. Add a module dependency only with a stated reason, and commit `go.sum` with it.
- Return errors with context (`fmt.Errorf("open %s: %w", path, err)`); do not call `log.Fatal` outside `main`.
- HTTP handlers set explicit `Content-Type` and caching headers that match the static hosting rules in [platform/hosting](../../platform/hosting).

### Tests

- Table-driven tests with `net/http/httptest` for handlers. Tests create their own temporary directories with `t.TempDir()`.
- Add a test that fails without your change. Do not skip or delete failing tests.
- Verify: `make verify PKG=services/backend` (same as `make check-go`).

<!-- END GENERATED agent-guidelines -->
