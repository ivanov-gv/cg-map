.PHONY: setup hooks dev dev-mock check check-docs ci-plan test-all-workflows test-ci-all test-ci-docs test-ci-workflows test-ci-platform test-ci-contracts test-ci-data test-ci-backend test-ci-transit-relay test-ci-tests test-ci-apps-web test-cd-pages verify test test-e2e test-e2e-built build build-web build-data pages check-go agent-rules worktree

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

# All Markdown, wherever it lives, plus the repository and agent-rule checks. Fast and needs no web build.
check-docs:
	npm run lint:md
	npm run check:repo
	npm run check:agents

# Which folder pipelines and browser areas a change needs: make ci-plan [BASE=origin/main]
ci-plan:
	node platform/tools/ci-plan.mjs --base $(or $(BASE),origin/main)

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

# Local workflow runs, always in test-run mode: see .github/TESTING.md. Dry run: make test-all-workflows ACT="gh act -n"
ACT ?= gh act
ACT_RUN = --input test_run=true --input run_all=true --var-file .github/act/var.env --artifact-server-path .build/act-artifacts --network bridge --pull=false -P ubuntu-24.04=catthehacker/ubuntu:act-24.04 -P ubuntu-latest=catthehacker/ubuntu:act-24.04

test-all-workflows: test-ci-all test-ci-docs test-ci-workflows test-ci-platform test-ci-contracts test-ci-data test-ci-backend test-ci-transit-relay test-ci-tests test-ci-apps-web test-cd-pages

test-ci-all test-ci-docs test-ci-workflows test-ci-platform test-ci-contracts test-ci-data test-ci-backend test-ci-transit-relay test-ci-tests test-ci-apps-web: test-%:
	$(ACT) workflow_dispatch -W .github/workflows/$*.yml $(ACT_RUN)

# Needs a real ci-all test run to read from: make test-cd-pages RUN_ID=<run ID>
test-cd-pages:
	$(ACT) workflow_dispatch -W .github/workflows/cd-pages.yml $(ACT_RUN) --input run_id=$(RUN_ID) -s GITHUB_TOKEN="$$(gh auth token)"
