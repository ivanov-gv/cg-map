.PHONY: setup hooks dev dev-mock check verify test test-e2e test-e2e-built build build-web build-data pages check-go agent-rules worktree

# Stable per-worktree dev port; override with PORT=... (E2E_PORT is owned by apps/web).
PORT ?= $(shell node platform/tools/dev-port.mjs)

setup: hooks
	npm ci --ignore-scripts

# Point git at the repository hooks (pre-commit: fast checks; pre-push: make check).
hooks:
	git config core.hooksPath platform/git-hooks

# Server-mode preview: the Go backend serves dist/web plus the layers and transport APIs.
# Extra server flags: make dev DEV_FLAGS=-live-transport=false
dev: build-web
	mkdir -p .build
	$(MAKE) --no-print-directory -C services/backend build
	.build/kompas -dir dist/web -listen 127.0.0.1:$(PORT) -shutdown-delay 0 $(DEV_FLAGS)

# Mock-mode preview, as on GitHub Pages: static dist/web only, no backend.
dev-mock:
	$(MAKE) --no-print-directory -C apps/web dev-mock PORT=$(PORT)

check:
	npm run check

# make verify PKG=<component or path>; without PKG runs make check and check-go.
verify:
	node platform/tools/verify.mjs $(PKG)

test: build-web
	npm test
	python3 -m unittest discover -s platform/tests -p 'test_*.py'

test-e2e:
	$(MAKE) --no-print-directory -C apps/web e2e

test-e2e-built:
	$(MAKE) --no-print-directory -C apps/web e2e-built

build: build-web

build-web:
	$(MAKE) --no-print-directory -C apps/web build

# Expensive geography regeneration; requires data/tools/requirements.txt.
build-data:
	$(MAKE) --no-print-directory -C data build-data

pages: build-web

check-go:
	$(MAKE) --no-print-directory -C services/backend check

# Regenerate .claude/rules and component AGENTS.md blocks from docs/engineering.
agent-rules:
	$(MAKE) --no-print-directory -C platform agent-rules

# make worktree NAME=<branch> [BASE=main]: isolated checkout for a parallel agent session.
worktree:
	$(MAKE) --no-print-directory -C platform worktree NAME="$(NAME)" BASE="$(BASE)"
