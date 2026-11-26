ROOT := ../..

.PHONY: verify lint test

verify: lint test

lint:
	npx --no-install eslint *.mjs tests/*.mjs

test:
	cd $(ROOT) && node --test services/transit-relay/tests/*.test.mjs