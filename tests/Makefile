ROOT := ..
DATA_HELPER := $(abspath $(ROOT)/tests/data-root.mjs)
CONTRACTS_HELPER := $(abspath $(ROOT)/tests/contracts-root.mjs)
MAP_DATA_VERSION ?=
MAP_CONTRACTS_VERSION ?=
# With a version, release-packages installs that exact pinned release before any target reads its root.
DATA_ROOT_ARG = $(if $(strip $(MAP_DATA_VERSION)), --published,)
CONTRACTS_ROOT_ARG = $(if $(strip $(MAP_CONTRACTS_VERSION)), --published,)
DATA_ROOT = $$(node $(DATA_HELPER)$(DATA_ROOT_ARG))
CONTRACTS_ROOT = $$(node $(CONTRACTS_HELPER)$(CONTRACTS_ROOT_ARG))
RELEASE_PACKAGES = $(if $(strip $(MAP_DATA_VERSION)$(MAP_CONTRACTS_VERSION)),release-packages,)

ifneq ($(strip $(RELEASE_PACKAGES)),)
lint build-web build-editor integration-test: $(RELEASE_PACKAGES)
endif

.PHONY: verify lint build-web build-editor integration-test release-packages

verify: lint build-web build-editor integration-test

lint:
	cd $(ROOT) && MAP_DATA_ROOT="$(DATA_ROOT)" MAP_CONTRACTS_ROOT="$(CONTRACTS_ROOT)" npx --no-install eslint tests

# Integration tests read the built web artifact, a listed contract. That build uses the same data and contracts roots, and
# the core of this commit as every build that is not a release does.
build-web:
	MAP_DATA_ROOT="$(DATA_ROOT)" MAP_CONTRACTS_ROOT="$(CONTRACTS_ROOT)" $(MAKE) --no-print-directory -C $(ROOT)/apps/web build

# A core, data or contracts change that breaks the editor's dev build fails here, because no app pipeline runs for it.
build-editor:
	MAP_DATA_ROOT="$(DATA_ROOT)" MAP_CONTRACTS_ROOT="$(CONTRACTS_ROOT)" $(MAKE) --no-print-directory -C $(ROOT)/apps/editor build

integration-test:
	cd $(ROOT) && MAP_DATA_ROOT="$(DATA_ROOT)" MAP_CONTRACTS_ROOT="$(CONTRACTS_ROOT)" node --test tests/integration/*.test.mjs

release-packages:
	@packages='$(if $(strip $(MAP_DATA_VERSION)),@ivanov-gv/map-data@$(MAP_DATA_VERSION))$(if $(strip $(MAP_CONTRACTS_VERSION)), @ivanov-gv/map-contracts@$(MAP_CONTRACTS_VERSION))'; \
	NODE_AUTH_TOKEN="$${NODE_AUTH_TOKEN:-$$(gh auth token)}" npm install --prefix $(ROOT)/tests --userconfig $(ROOT)/.npmrc --no-save --ignore-scripts --package-lock=false $$packages >/dev/null
