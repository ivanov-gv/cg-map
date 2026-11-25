ROOT := ../..

.PHONY: verify lint test

# Checks these files only. The planner runs each producer's and consumer's own pipeline when a contract changes.
verify: lint test

lint:
	npx --no-install eslint tests

test:
	node --test tests/*.test.mjs
