.PHONY: setup hooks check check-docs ci-plan lint-workflows test-all-workflows test-cd-map-core test-cd-dev-pages test-ci-pr-checks test-ci-nightly test-ci-dev-pages test-ci-docs test-ci-workflows test-ci-platform test-ci-contracts test-ci-data test-ci-backend test-ci-transit-relay test-ci-tests test-ci-map-core test-ci-apps-web test-ci-apps-editor test-ci-apps-core-demo test-ci-publish test-ci-browser-image test-cd-browser-image test-cd-map-core act-image verify test-e2e check-go agent-rules worktree

# Repository-wide tasks only. Every project builds, runs, lints and tests itself through its own Makefile; this file
# may call a project's check targets but never its build or run targets. See docs/system-architecture/architecture.md.
# services/backend stays out of PROJECTS: it needs Go, so make check-go checks it separately.
PROJECTS := packages/map-core apps/web apps/editor apps/core-demo data packages/contracts services/transit-relay platform tests
BROWSER_PROJECTS := apps/web apps/editor apps/core-demo

# GitHub Packages asks for a token even to install a public package. gh needs the read:packages scope.
setup: hooks
	NODE_AUTH_TOKEN="$$(gh auth token)" npm ci --ignore-scripts

# Point git at the repository hooks (pre-commit: fast checks; pre-push: make check).
hooks:
	git config core.hooksPath platform/git-hooks

check:
	@for project in $(PROJECTS); do \
		echo "> $$project"; \
		$(MAKE) --no-print-directory -C $$project verify || exit 1; \
	done

# All Markdown, wherever it lives, the repository checks, and agent rules, including what root AGENTS.md must say.
# Fast, and needs no web build.
check-docs:
	npm run lint:md
	npm run check:repo
	npm run check:agents
	node --test platform/tests/agents.test.mjs

# Which folder pipelines and browser areas a change needs: make ci-plan [BASE=origin/main]
ci-plan:
	node platform/tools/ci-plan.mjs --base $(or $(BASE),origin/main)

# make verify PKG=<component or path>; without PKG runs make check and check-go.
verify:
	node platform/tools/verify.mjs $(PKG)

# Each project owns its browser tests and builds what they need. For filters, run make -C <project> e2e E2E_ARGS=...
test-e2e:
	@for project in $(BROWSER_PROJECTS); do \
		echo "> $$project"; \
		$(MAKE) --no-print-directory -C $$project e2e || exit 1; \
	done

check-go:
	$(MAKE) --no-print-directory -C services/backend check

# Regenerate .claude/rules and component AGENTS.md blocks from docs/engineering.
agent-rules:
	$(MAKE) --no-print-directory -C platform agent-rules

# make worktree NAME=<branch> [BASE=main]: isolated checkout for a parallel agent session.
worktree:
	$(MAKE) --no-print-directory -C platform worktree NAME="$(NAME)" BASE="$(BASE)"

# Lint all workflow YAML files with actionlint.
# CI pins rhysd/actionlint:1.7.12, which also runs shellcheck. Use the local binary only when it is 1.7.12 and
# shellcheck is installed; otherwise use the pinned image.
lint-workflows:
	@if command -v actionlint >/dev/null 2>&1 && command -v shellcheck >/dev/null 2>&1 && \
	   [ "$$(actionlint -version 2>&1 | head -1 | sed 's/^v//')" = "1.7.12" ]; then \
		actionlint -color; \
	else \
		docker run --rm -v "$$(pwd)":/repo -w /repo rhysd/actionlint:1.7.12 -color; \
	fi

# Local workflow runs, always in test-run mode: see .github/TESTING.md. Dry run: make test-all-workflows ACT="gh act -n"
ACT ?= gh act
# Pinned, as in the workflows: every machine runs local jobs on the same image CI uses.
ACT_IMAGE := ghcr.io/ivanov-gv/cg-map/browser-ci:1.56.1-r1
# Browser jobs render on the GPU where there is one. Too many at once time out tests: four did, with or without a GPU.
# A job's own container takes its options from the workflow, not from act's flag, so both are needed.
ACT_GPU_OPTIONS := $(if $(wildcard /dev/dri/renderD128),--device /dev/dri)
ACT_GPU := $(if $(wildcard /dev/dri/renderD128),--var BROWSER_CONTAINER_OPTIONS="--device /dev/dri" --env E2E_ANGLE=gl-egl)
# In a worktree, .git is a file pointing to the main checkout's .git/worktrees/<name>.
# act copies the working tree but not the main checkout's .git, so git commands fail inside containers.
# Mounting the git common directory (the main .git) at the same absolute path fixes it.
# In the main checkout the common dir is ./.git, so the mount is harmless there too.
GIT_COMMON_DIR := $(abspath $(shell git rev-parse --git-common-dir))
ACT_CONTAINER_OPTIONS := -v $(GIT_COMMON_DIR):$(GIT_COMMON_DIR) $(ACT_GPU_OPTIONS)
ACT_JOBS ?= 2
# The limit applies to each called workflow, and ci-pr-checks calls many at once.
# ci-nightly calls ci-pr-checks, which calls many workflows at once.
test-ci-pr-checks test-ci-nightly: ACT_JOBS = 1
ACT_RUN = --input test_run=true --input run_all=true --var-file .github/act/var.env --secret-file .github/act/secret.env --artifact-server-path .build/act-artifacts --network bridge --pull=false --container-options "$(ACT_CONTAINER_OPTIONS)" $(ACT_GPU) --concurrent-jobs $(ACT_JOBS) -P ubuntu-24.04=$(ACT_IMAGE) -P ubuntu-latest=$(ACT_IMAGE)

# The CD targets come first, so a missing VERSION stops the run straight away.
test-all-workflows: test-cd-map-core test-cd-dev-pages test-cd-browser-image test-ci-pr-checks test-ci-nightly test-ci-dev-pages test-ci-docs test-ci-workflows test-ci-platform test-ci-contracts test-ci-data test-ci-backend test-ci-transit-relay test-ci-tests test-ci-map-core test-ci-apps-web test-ci-apps-editor test-ci-apps-core-demo test-ci-publish test-ci-browser-image

test-ci-pr-checks test-ci-nightly test-ci-dev-pages test-ci-docs test-ci-workflows test-ci-platform test-ci-contracts test-ci-data test-ci-backend test-ci-transit-relay test-ci-tests test-ci-map-core test-ci-apps-web test-ci-apps-editor test-ci-apps-core-demo test-ci-publish test-ci-browser-image: test-%: act-image
	$(ACT) workflow_dispatch -W .github/workflows/$*.yml $(ACT_RUN)

# Needs a dev package CI published from main: make test-cd-map-core VERSION=0.2.0 COMMIT=<full SHA>
test-cd-map-core: act-image
	$(if $(or $(VERSION),$(findstring -n,$(ACT))),,$(error Set VERSION and COMMIT: make test-cd-map-core VERSION=0.2.0 COMMIT=<full SHA>))
	$(ACT) workflow_dispatch -W .github/workflows/cd-map-core.yml $(ACT_RUN) --input version=$(VERSION) --input commit=$(COMMIT)

# A release version never changes, so an image already here is the right one. A dry run starts no job, so it needs none.
act-image:
	$(if $(findstring -n,$(ACT)),,docker image inspect $(ACT_IMAGE) > /dev/null 2>&1 || docker pull $(ACT_IMAGE) || (echo 'Log in first: gh auth token | docker login ghcr.io --username <you> --password-stdin' && exit 1))

# Needs an image from make test-ci-publish, whose commit it promotes: make test-cd-browser-image VERSION=1.56.1-r2 COMMIT=<full SHA>
test-cd-browser-image: act-image
	$(if $(or $(VERSION),$(findstring -n,$(ACT))),,$(error Set VERSION and COMMIT: make test-cd-browser-image VERSION=1.56.1-r2 COMMIT=<full SHA>))
	$(ACT) workflow_dispatch -W .github/workflows/cd-browser-image.yml $(ACT_RUN) --input version=$(VERSION) --input commit=$(COMMIT)

# Needs a recent main SHA with a successful ci-dev-pages run: make test-cd-dev-pages COMMIT=<full SHA>
# Find one with: gh run list --workflow ci-dev-pages.yml --branch main --status success
# Or test the workflow_run path (uses .github/act/event-workflow-run.json): make test-cd-dev-pages
test-cd-dev-pages: act-image
ifneq ($(COMMIT),)
	$(ACT) workflow_dispatch -W .github/workflows/cd-dev-pages.yml $(ACT_RUN) --input commit=$(COMMIT)
else
	$(ACT) workflow_run -W .github/workflows/cd-dev-pages.yml $(ACT_RUN) -e .github/act/event-workflow-run.json
endif
