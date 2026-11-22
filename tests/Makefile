ROOT := ..
DATA_HELPER := $(abspath $(ROOT)/tests/data-root.mjs)
MAP_DATA_VERSION ?=
# With a version, data-package installs the exact release before any target reads the data root.
DATA_ROOT_ARG = $(if $(strip $(MAP_DATA_VERSION)), --published,)
DATA_ROOT = $$(node $(DATA_HELPER)$(DATA_ROOT_ARG))

ifneq ($(strip $(MAP_DATA_VERSION)),)
lint build-web integration-test: data-package
endif

.PHONY: verify lint build-web integration-test data-package

verify: lint build-web integration-test

lint:
	cd $(ROOT) && MAP_DATA_ROOT="$(DATA_ROOT)" npx --no-install eslint tests

# Integration tests read the built web artifact, a listed contract. That build uses the same data root.
build-web:
	MAP_DATA_ROOT="$(DATA_ROOT)" $(MAKE) --no-print-directory -C $(ROOT)/apps/web build

integration-test:
	cd $(ROOT) && MAP_DATA_ROOT="$(DATA_ROOT)" node --test tests/integration/*.test.mjs

data-package:
	NODE_AUTH_TOKEN="$${NODE_AUTH_TOKEN:-$$(gh auth token)}" npm install --prefix $(ROOT)/tests --userconfig $(ROOT)/.npmrc --no-save --ignore-scripts --package-lock=false @ivanov-gv/map-data@$(MAP_DATA_VERSION) >/dev/null
