ROOT := ..
PYTHON ?= python3

.PHONY: verify lint check check-topology build-data build-relief apply-changeset test python-test python-check transit-routes

verify: lint check test python-test python-check check-topology

lint:
	cd $(ROOT) && npx --no-install eslint data/tools data/tests

check:
	npm run -s check

# GIS topology is a separate, Shapely-backed check; structural check-data stays dependency-free.
check-topology:
	cd $(ROOT) && python3 data/tools/check-shared-edges.py

build-data:
	npm run build

# Rebuilds the five reviewed relief sources from external inputs outside Git.
build-relief:
	cd $(ROOT) && $(PYTHON) data/tools/build-relief.py

# Applies a reviewed editor export to data/sources: make -C data apply-changeset CHANGESET=<absolute path>. Never commits.
apply-changeset:
	$(if $(CHANGESET),,$(error Set CHANGESET to the absolute path of a changeset file))
	cd $(ROOT) && node data/tools/apply-changeset.mjs $(abspath $(CHANGESET)) --contracts-directory $(abspath $(ROOT)/packages/contracts)

# Regenerate transport-stops and transit-routes from current sources.
# Requires Python venv with osmium: ~/.cache/cg-map/venv/bin/python.
transit-routes:
	~/.cache/cg-map/venv/bin/python data/tools/enrich_stops.py
	~/.cache/cg-map/venv/bin/python data/tools/build_transit_routes.py

test:
	cd $(ROOT) && node --test data/tests/*.test.mjs

python-check:
	cd $(ROOT) && python3 -m py_compile data/tools/*.py data/tools/osm_extract/*.py data/tools/relief/*.py

python-test:
	cd $(ROOT) && python3 -m unittest discover -s data/tests -p 'test_*.py'
