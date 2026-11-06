ROOT := ..

.PHONY: verify lint build-web integration-test

verify: lint build-web integration-test

lint:
	cd $(ROOT) && npx --no-install eslint tests

# Integration tests read the built web artifact, a listed contract.
build-web:
	$(MAKE) --no-print-directory -C $(ROOT)/apps/web build

integration-test:
	cd $(ROOT) && node --test tests/integration/*.test.mjs
