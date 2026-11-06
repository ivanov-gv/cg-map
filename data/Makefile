ROOT := ..

.PHONY: verify lint check build-data apply-changeset test python-test python-check

verify: lint check test python-test python-check

lint:
	cd $(ROOT) && npx --no-install eslint data/tools data/tests

check:
	npm run -s check

build-data:
	npm run build

# Applies a reviewed editor export to data/sources: make -C data apply-changeset CHANGESET=<absolute path>. Never commits.
apply-changeset:
	$(if $(CHANGESET),,$(error Set CHANGESET to the absolute path of a changeset file))
	cd $(ROOT) && node data/tools/apply-changeset.mjs $(abspath $(CHANGESET))

test:
	cd $(ROOT) && node --test data/tests/*.test.mjs

python-check:
	cd $(ROOT) && python3 -m py_compile data/tools/*.py

python-test:
	cd $(ROOT) && python3 -m unittest discover -s data/tests -p 'test_*.py'
