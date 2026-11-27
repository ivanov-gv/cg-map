ROOT := ../..
ARTIFACT ?= $(ROOT)/dist/web
PORT ?= 8080
# golangci-lint keys its cache by file content and stores absolute paths, so a cache shared between worktrees replays
# findings from whichever worktree linted identical files first, even one that no longer exists.
export GOLANGCI_LINT_CACHE ?= $(abspath $(ROOT)/.build/golangci-lint-cache)
# Pinned here, not in go.mod, so the linter's dependencies stay out of the server module.
GOLANGCI_LINT := go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2
# Dev generation reads the shared formats and proto from this commit; generate-check and releases read the installed
# pin. Each recipe resolves its own root, so a failed resolution stops the target instead of leaving an empty path.

.PHONY: verify check check-roots format-check vet lint test build build-release run generate generate-release generate-check

verify: check

check: format-check vet lint test build check-roots

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

# A release ships bindings checked against the exact contracts pin, then builds the server from them.
build-release: generate-check build

# Hosts a built web artifact with the layers and transport APIs. Extra server flags: make run DEV_FLAGS=...
run: build
	$(ROOT)/.build/kompas -dir $(ARTIFACT) -listen 127.0.0.1:$(PORT) -shutdown-delay 0 $(DEV_FLAGS)

# Buf 1.75.0 compiles the shared schema; generator versions come from go.mod.
generate:
	@set -eu; contracts_root=$$(sh tools/contracts-root.sh dev); \
	buf lint "$$contracts_root/proto"; \
	buf generate "$$contracts_root/proto" --template buf.gen.yaml

# A release regenerates bindings from the exact pinned package and refuses another contracts root.
generate-release:
	@set -eu; contracts_root=$$(sh tools/contracts-root.sh release); \
	buf lint "$$contracts_root/proto"; \
	buf generate "$$contracts_root/proto" --template buf.gen.yaml

# Regenerate outside the source tree from the pin to catch stale committed bindings; build-release calls this target.
# Regular check and CI compile the committed bindings without regenerating them.
generate-check:
	@set -eu; contracts_root=$$(sh tools/contracts-root.sh pinned); \
	generated=$$(mktemp -d); trap 'rm -rf "$$generated"' EXIT; \
	buf lint "$$contracts_root/proto"; \
	buf generate "$$contracts_root/proto" --template buf.gen.yaml --output "$$generated"; \
	diff -ru gen "$$generated/gen"

check-roots:
	sh tools/contracts-root.test.sh
