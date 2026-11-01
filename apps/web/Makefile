ROOT := ../..

.PHONY: verify lint repo build build-web test offline-check

verify: lint repo build test offline-check

lint:
	cd $(ROOT) && npx --no-install eslint apps/web/src apps/web/tools apps/web/tests

repo:
	cd $(ROOT) && node platform/tools/check-repo.mjs

build build-web:
	cd $(ROOT) && npm run build:web

test:
	cd $(ROOT) && node --test apps/web/tests/*.test.mjs

offline-check:
	cd $(ROOT) && node apps/web/tools/finalize.mjs --check