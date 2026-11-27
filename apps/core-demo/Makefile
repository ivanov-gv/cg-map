ROOT := ../..
# A separate origin keeps this preview outside the public app's service worker. Override with PORT=...
PORT ?= $(shell node $(ROOT)/platform/tools/dev-port.mjs --app core-demo)
E2E_ARGS ?=
# Resolved only for release and test targets. Every other build takes core, data and contracts from its own commit.
PINNED_DATA_ROOT = $(shell node tests/pinned-data.mjs)
PINNED_CONTRACTS_ROOT = $(shell node tests/pinned-contracts.mjs)
PINNED_CORE_ROOT = $(shell node tests/pinned-core.mjs)
verify test e2e e2e-built build-release: export MAP_DATA_ROOT = $(if $(PINNED_DATA_ROOT),$(PINNED_DATA_ROOT),$(error Cannot resolve @ivanov-gv/map-data; run make setup))
verify test e2e e2e-built build-release: export MAP_CONTRACTS_ROOT = $(if $(PINNED_CONTRACTS_ROOT),$(PINNED_CONTRACTS_ROOT),$(error Cannot resolve @ivanov-gv/map-contracts; run make setup))
verify test e2e e2e-built build-release: export MAP_CORE_ROOT = $(if $(PINNED_CORE_ROOT),$(PINNED_CORE_ROOT),$(error Cannot resolve @ivanov-gv/map-core; run make setup))

.PHONY: verify lint test build build-release dev e2e e2e-built

verify: lint build test

lint:
	npm run lint

test:
	npm test

build:
	npm run build

# What a release ships: the exact core, data and contracts this app pins.
build-release:
	CORE_DEMO_RELEASE=1 npm run build

dev: build
	python3 $(ROOT)/platform/tools/serve.py --port $(PORT) --app core-demo

# Builds this app first, then runs its browser tests.
e2e:
	npm run test:e2e -- $(E2E_ARGS)

# Reuses the artifact from a successful build, as CI does after verify.
e2e-built:
	npm run test:e2e:built -- $(E2E_ARGS)
