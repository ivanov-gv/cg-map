.PHONY: setup hooks dev dev-mock check verify test test-e2e build build-web build-data pages check-go agent-rules worktree

# Stable per-worktree ports; override with PORT=... or E2E_PORT=...
PORT ?= $(shell node platform/tools/dev-port.mjs)
E2E_PORT ?= $(shell node platform/tools/dev-port.mjs --e2e)
export E2E_PORT

setup: hooks
	npm ci --ignore-scripts

# Point git at the repository hooks (pre-commit: fast checks; pre-push: make check).
hooks:
	git config core.hooksPath platform/git-hooks

# Server-mode preview: the Go backend serves dist/web plus the layers and transport APIs.
# Extra server flags: make dev DEV_FLAGS=-live-transport=false
dev: build-web
	mkdir -p .build
	cd services/backend && go build -o ../../.build/kompas ./cmd/server
	.build/kompas -dir dist/web -listen 127.0.0.1:$(PORT) -shutdown-delay 0 $(DEV_FLAGS)

# Mock-mode preview, as on GitHub Pages: static dist/web only, no backend.
dev-mock: build-web
	python3 platform/tools/serve.py --port $(PORT)

check:
	npm run check

# make verify PKG=<component or path>; without PKG runs make check and check-go.
verify:
	node platform/tools/verify.mjs $(PKG)

test: build-web
	npm test
	python3 -m unittest discover -s platform/tests -p 'test_*.py'

test-e2e:
	npm run test:e2e

build: build-web

build-web:
	npm run build:web

# Expensive geography regeneration; requires data/tools/requirements.txt.
build-data:
	npm run build:data

pages: build-web

check-go:
	@cd services/backend && unformatted=$$(gofmt -l .) && if [ -n "$$unformatted" ]; then echo "gofmt needed (run gofmt -w):" >&2; echo "$$unformatted" >&2; exit 1; fi
	cd services/backend && go vet ./...
	cd services/backend && go test ./...
	mkdir -p .build
	cd services/backend && go build -o ../../.build/kompas ./cmd/server

# Regenerate .claude/rules and component AGENTS.md blocks from docs/engineering.
agent-rules:
	node platform/agents/gen-agent-rules.mjs

# make worktree NAME=<branch> [BASE=main]: isolated checkout for a parallel agent session.
worktree:
	sh platform/tools/worktree.sh $(NAME) $(BASE)
