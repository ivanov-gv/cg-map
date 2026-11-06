ROOT := ../..

.PHONY: verify lint test

# Checks these files only. The planner runs each producer's and consumer's own pipeline when a contract changes.
verify: lint test

lint:
	cd $(ROOT) && npx --no-install eslint packages/contracts/tests

test:
	node --test tests/*.test.mjs
