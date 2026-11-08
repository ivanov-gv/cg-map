ROOT := ../..
# A separate origin keeps this preview outside the public app's service worker. Override with PORT=...
PORT ?= $(shell node $(ROOT)/platform/tools/dev-port.mjs --app editor)
E2E_ARGS ?=
# Stays fixed: the browser ties an installed app to its origin, and a new port would be a new app.
LAN_PORT ?= 8443
LAN_TLS := $(ROOT)/.build/lan-tls

.PHONY: verify lint test build dev lan e2e e2e-built measure-datasets

verify: lint build test

lint:
	npm run lint

test:
	npm test

build:
	npm run build

dev: build
	python3 $(ROOT)/platform/tools/serve.py --port $(PORT) --app editor

# Serves the installable editor to this LAN over HTTPS. See README.md, "Install on your devices".
lan: build
	python3 $(ROOT)/platform/tools/lan_certificate.py --output-directory $(LAN_TLS) --install-port $(LAN_PORT)
	python3 $(ROOT)/platform/tools/serve.py --host 0.0.0.0 --port $(LAN_PORT) --app editor --tls-directory $(LAN_TLS)

# Builds this app first, then runs its browser tests.
e2e:
	npm run test:e2e -- $(E2E_ARGS)

# Reuses the artifact from a successful build, as CI does after verify.
e2e-built:
	npm run test:e2e:built -- $(E2E_ARGS)

# How startup and mode switches grow with source size, in a real browser. See README.md, "Larger datasets".
measure-datasets: build
	node tools/measure-datasets.mjs
