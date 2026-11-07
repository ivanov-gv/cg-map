.PHONY: setup hooks check check-docs ci-plan test-all-workflows test-cd-map-core test-ci-all test-ci-dev-pages test-ci-docs test-ci-workflows test-ci-platform test-ci-contracts test-ci-data test-ci-backend test-ci-transit-relay test-ci-tests test-ci-map-core test-ci-apps-web test-ci-apps-editor test-ci-apps-core-demo test-ci-publish test-cd-map-core act-image verify test-e2e check-go agent-rules worktree

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

# Local workflow runs, always in test-run mode: see .github/TESTING.md. Dry run: make test-all-workflows ACT="gh act -n"
ACT ?= gh act
ACT_IMAGE := cg-map-act:local
# A job runs two browser workers, and more jobs than this at once cause load-related test timeouts.
ACT_JOBS ?= 4
ACT_RUN = --input test_run=true --input run_all=true --var-file .github/act/var.env --secret-file .github/act/secret.env --artifact-server-path .build/act-artifacts --network bridge --pull=false --concurrent-jobs $(ACT_JOBS) -P ubuntu-24.04=$(ACT_IMAGE) -P ubuntu-latest=$(ACT_IMAGE)

# test-cd-map-core comes first, so a missing VERSION stops the run straight away.
test-all-workflows: test-cd-map-core test-ci-all test-ci-dev-pages test-ci-docs test-ci-workflows test-ci-platform test-ci-contracts test-ci-data test-ci-backend test-ci-transit-relay test-ci-tests test-ci-map-core test-ci-apps-web test-ci-apps-editor test-ci-apps-core-demo test-ci-publish

test-ci-all test-ci-dev-pages test-ci-docs test-ci-workflows test-ci-platform test-ci-contracts test-ci-data test-ci-backend test-ci-transit-relay test-ci-tests test-ci-map-core test-ci-apps-web test-ci-apps-editor test-ci-apps-core-demo test-ci-publish: test-%: act-image
	$(ACT) workflow_dispatch -W .github/workflows/$*.yml $(ACT_RUN)

# Needs a dev package CI published from main: make test-cd-map-core VERSION=0.2.0 COMMIT=<full SHA>
test-cd-map-core: act-image
	$(if $(or $(VERSION),$(findstring -n,$(ACT))),,$(error Set VERSION and COMMIT: make test-cd-map-core VERSION=0.2.0 COMMIT=<full SHA>))
	$(ACT) workflow_dispatch -W .github/workflows/cd-map-core.yml $(ACT_RUN) --input version=$(VERSION) --input commit=$(COMMIT)

# Reuses Docker's cache when nothing changed. A dry run starts no job, so it needs no image.
act-image:
	$(if $(findstring -n,$(ACT)),,docker build --quiet --tag $(ACT_IMAGE) --build-arg PLAYWRIGHT_VERSION=$$(node --print "require('./package-lock.json').packages['node_modules/playwright'].version") platform/act-image)
