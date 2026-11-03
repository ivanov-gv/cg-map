ROOT := ..

.PHONY: verify lint build-web integration-test e2e

verify: lint build-web integration-test

lint:
	cd $(ROOT) && npx --no-install eslint tests

build-web:
	cd $(ROOT) && npm run -s build:web

integration-test:
	cd $(ROOT) && node --test tests/integration/*.test.mjs

e2e:
	$(MAKE) --no-print-directory -C $(ROOT)/apps/web e2e
