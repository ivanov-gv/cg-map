ROOT := ..
E2E_PORT ?= $(shell cd $(ROOT) && node platform/tools/dev-port.mjs --e2e)

.PHONY: verify lint build-web integration-test e2e

verify: lint build-web integration-test

lint:
	cd $(ROOT) && npx --no-install eslint tests

build-web:
	cd $(ROOT) && npm run -s build:web

integration-test:
	cd $(ROOT) && node --test tests/integration/*.test.mjs

e2e:
	cd $(ROOT) && E2E_PORT=$(E2E_PORT) npm run test:e2e