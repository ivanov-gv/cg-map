ROOT := ../..
# A separate origin keeps this preview outside the public app's service worker. Override with PORT=...
PORT ?= $(shell node $(ROOT)/platform/tools/dev-port.mjs --app editor)
E2E_ARGS ?=

.PHONY: verify lint test build dev e2e e2e-built

verify: lint build test

lint:
	npm run lint

test:
	npm test

build:
	npm run build

dev: build
	python3 $(ROOT)/platform/tools/serve.py --port $(PORT) --app editor

# Builds this app first, then runs its browser tests.
e2e:
	npm run test:e2e -- $(E2E_ARGS)

# Reuses the artifact from a successful build, as CI does after verify.
e2e-built:
	npm run test:e2e:built -- $(E2E_ARGS)
