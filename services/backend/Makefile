ROOT := ../..
ARTIFACT ?= $(ROOT)/dist/web
PORT ?= 8080
# golangci-lint keys its cache by file content and stores absolute paths, so a cache shared between worktrees replays
# findings from whichever worktree linted identical files first, even one that no longer exists.
export GOLANGCI_LINT_CACHE ?= $(abspath $(ROOT)/.build/golangci-lint-cache)
# Pinned here, not in go.mod, so the linter's dependencies stay out of the server module.
GOLANGCI_LINT := go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2

.PHONY: verify check format-check vet lint test build run generate generate-check

verify: check

check: format-check vet lint test build

format-check:
	@unformatted=$$(gofmt -l .) && if [ -n "$$unformatted" ]; then echo "gofmt needed (run gofmt -w):" >&2; echo "$$unformatted" >&2; exit 1; fi

vet:
	go vet ./...

lint:
	$(GOLANGCI_LINT) run ./...

test:
	go test -count=1 -race ./...

build:
	mkdir -p $(ROOT)/.build
	go build -o $(ROOT)/.build/kompas ./cmd/server

# Hosts a built web artifact with the layers and transport APIs. Extra server flags: make run DEV_FLAGS=...
run: build
	$(ROOT)/.build/kompas -dir $(ARTIFACT) -listen 127.0.0.1:$(PORT) -shutdown-delay 0 $(DEV_FLAGS)

# Buf 1.75.0 compiles the shared schema; generator versions come from go.mod.
generate:
	buf lint $(ROOT)/packages/contracts/proto
	buf generate $(ROOT)/packages/contracts/proto --template buf.gen.yaml

# Regenerate outside the source tree to catch stale committed bindings.
generate-check:
	@set -eu; generated=$$(mktemp -d); trap 'rm -rf "$$generated"' EXIT; \
	buf lint $(ROOT)/packages/contracts/proto; \
	buf generate $(ROOT)/packages/contracts/proto --template buf.gen.yaml --output "$$generated"; \
	diff -ru gen "$$generated/gen"
