ROOT := ..

.PHONY: verify lint check build-data test python-test python-check

verify: lint check test python-test python-check

lint:
	cd $(ROOT) && npx --no-install eslint data/tools data/tests

check:
	cd $(ROOT) && npm run -s check:data

build-data:
	cd $(ROOT) && npm run build:data

test:
	cd $(ROOT) && node --test data/tests/*.test.mjs

python-check:
	cd $(ROOT) && python3 -m py_compile data/tools/*.py

python-test:
	cd $(ROOT) && python3 -m unittest discover -s data/tests -p 'test_*.py'
