ROOT := ../..
# A separate origin keeps this preview outside the public app's service worker. Override with PORT=...
PORT ?= $(shell node $(ROOT)/platform/tools/dev-port.mjs --app core-demo)
E2E_ARGS ?=
# Resolved only for test targets. A dev or release build keeps its repository data and contracts roots.
PINNED_DATA_ROOT = $(shell node tests/pinned-data.mjs)
PINNED_CONTRACTS_ROOT = $(shell node tests/pinned-contracts.mjs)
verify test e2e e2e-built: export MAP_DATA_ROOT = $(if $(PINNED_DATA_ROOT),$(PINNED_DATA_ROOT),$(error Cannot resolve @ivanov-gv/map-data; run make setup))
verify test e2e e2e-built: export MAP_CONTRACTS_ROOT = $(if $(PINNED_CONTRACTS_ROOT),$(PINNED_CONTRACTS_ROOT),$(error Cannot resolve @ivanov-gv/map-contracts; run make setup))

.PHONY: verify lint test build dev e2e e2e-built

verify: lint build test

lint:
	npm run lint

test:
	npm test

build:
	npm run build

dev: build
	python3 $(ROOT)/platform/tools/serve.py --port $(PORT) --app core-demo

# Builds this app first, then runs its browser tests.
e2e:
	npm run test:e2e -- $(E2E_ARGS)

# Reuses the artifact from a successful build, as CI does after verify.
e2e-built:
	npm run test:e2e:built -- $(E2E_ARGS)
