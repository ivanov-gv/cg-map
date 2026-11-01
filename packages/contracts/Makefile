ROOT := ../..

.PHONY: verify check producer-check build-web consumer-test

verify: check

check: producer-check build-web consumer-test

producer-check:
	cd $(ROOT) && npm run -s check:data

build-web:
	cd $(ROOT) && npm run -s build:web

consumer-test:
	cd $(ROOT) && node --test tests/integration/contracts.test.mjs data/tests/*.test.mjs