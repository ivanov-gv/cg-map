---
description: Go conventions (generated from docs/engineering/go.md)
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
  - "**/go.work"
---

<!-- GENERATED from docs/engineering/go.md
by platform/agents/gen-agent-rules.mjs. Do not edit; run `make agent-rules`. -->

# Go conventions

Applies to `*.go`, `go.mod`, and `go.work`. Today this is the services/backend module only.

## Module boundaries

- services/backend is an independent module. It builds and tests without npm, Node, or raw geography. Enforced:
  `make check-go` and the backend CI workflow.
- The server serves an explicitly selected artifact directory. It does not embed or read web source, data/sources, or
  pipeline output paths directly.
- Do not scaffold placeholder services, APIs, or packages for future editorial work (see
  [ownership](docs/system-architecture/ownership.md)).

## Code

- Format with `gofmt`. Enforced: the git pre-commit hook and `make check-go` (`gofmt -l`).
- `go vet ./...` and golangci-lint must pass. Enforced: `make check-go`.
- Prefer the standard library. Add a module dependency only with a stated reason, and commit `go.sum` with it.
- Hold a mutex only inside a small method that locks, defers the unlock on the next line, and never waits on the
  network, a channel, or another lock, so a panic cannot leave it held and no path can miss an unlock. Reviewed, not
  enforced by a check.
- Return errors with context (`fmt.Errorf("open %s: %w", path, err)`); do not call `log.Fatal` outside `main`.
- HTTP handlers set explicit `Content-Type` and caching headers that match the static hosting rules in
  [platform/hosting](platform/hosting).

## Tests

- Table-driven tests with `net/http/httptest` for handlers. Tests create their own temporary directories with
  `t.TempDir()`.
- Add a test that fails without your change. Do not skip or delete failing tests.
- Verify: `make verify PKG=services/backend` (same as `make check-go`).
