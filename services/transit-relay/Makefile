ROOT := ../..

.PHONY: verify lint test

verify: lint test

lint:
	cd $(ROOT) && npx --no-install eslint services/transit-relay/*.mjs services/transit-relay/tests/*.mjs

test:
	cd $(ROOT) && node --test services/transit-relay/tests/*.test.mjs