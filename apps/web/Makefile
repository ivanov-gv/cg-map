ROOT := ../..
PORT ?= $(shell node $(ROOT)/platform/tools/dev-port.mjs)
E2E_ARGS ?=
# Resolved only for release and test targets. Every other build takes core, data and contracts from its own commit.
PINNED_DATA_ROOT = $(shell node tests/pinned-data.mjs)
PINNED_CONTRACTS_ROOT = $(shell node tests/pinned-contracts.mjs)
PINNED_CORE_ROOT = $(shell node tests/pinned-core.mjs)
verify test test-built offline-check e2e e2e-built build-release: export MAP_DATA_ROOT = $(if $(PINNED_DATA_ROOT),$(PINNED_DATA_ROOT),$(error Cannot resolve @ivanov-gv/map-data; run make setup))
verify test test-built offline-check e2e e2e-built build-release: export MAP_CONTRACTS_ROOT = $(if $(PINNED_CONTRACTS_ROOT),$(PINNED_CONTRACTS_ROOT),$(error Cannot resolve @ivanov-gv/map-contracts; run make setup))
verify test test-built offline-check e2e e2e-built build-release: export MAP_CORE_ROOT = $(if $(PINNED_CORE_ROOT),$(PINNED_CORE_ROOT),$(error Cannot resolve @ivanov-gv/map-core; run make setup))

.PHONY: verify lint build build-release test test-built offline-check e2e e2e-built dev dev-mock

verify: lint build test-built offline-check

lint:
	npm run lint

build:
	npm run build

# What a release ships: the exact released core, data and contracts this app's package.json pins.
build-release:
	npm run build

test:
	npm test

test-built:
	npm run test:built

offline-check:
	npm run check:offline

e2e:
	npm run test:e2e -- $(E2E_ARGS)

e2e-built:
	npm run test:e2e:built -- $(E2E_ARGS)

# Server-mode preview: the Go backend serves dist/web plus the layers and transport APIs.
# Extra server flags: make dev DEV_FLAGS=-live-transport=false
dev: build
	$(MAKE) --no-print-directory -C $(ROOT)/services/backend run PORT=$(PORT) DEV_FLAGS="$(DEV_FLAGS)"

# Mock-mode preview, as on GitHub Pages: static dist/web only, no backend.
dev-mock:
	PORT=$(PORT) npm run dev:mock
