ROOT := ../..
PORT ?= $(shell node $(ROOT)/platform/tools/dev-port.mjs)
E2E_ARGS ?=

.PHONY: verify lint repo build build-web test test-built offline-check python-check e2e e2e-built dev-mock

verify: lint repo build test-built offline-check python-check

lint:
	npm run lint

repo:
	cd $(ROOT) && node platform/tools/check-repo.mjs

build build-web:
	npm run build

test:
	npm test

test-built:
	npm run test:built

offline-check:
	npm run check:offline

python-check:
	npm run check:python

e2e:
	npm run test:e2e -- $(E2E_ARGS)

e2e-built:
	npm run test:e2e:built -- $(E2E_ARGS)

dev-mock:
	PORT=$(PORT) npm run dev:mock
