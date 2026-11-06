ROOT := ../..
PORT ?= $(shell node $(ROOT)/platform/tools/dev-port.mjs)
E2E_ARGS ?=

.PHONY: verify lint build test test-built offline-check e2e e2e-built dev dev-mock

verify: lint build test-built offline-check

lint:
	npm run lint

build:
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
