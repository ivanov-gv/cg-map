ROOT := ..

.PHONY: verify lint markdown-check repo agents-check build-web test python-test python-check agent-rules worktree browser-image

verify: lint markdown-check repo agents-check build-web test python-test python-check

# The root config stays Platform-owned until the app migrations remove it, so lint it from the root separately.
lint:
	npx --no-install eslint .
	cd $(ROOT) && npx --no-install eslint eslint.config.mjs

markdown-check:
	cd $(ROOT) && npm run -s lint:md

repo:
	cd $(ROOT) && npm run -s check:repo

agents-check:
	cd $(ROOT) && npm run -s check:agents

# The hosting tests run against a web artifact built from platform's own pinned data and contracts. Web's own target
# supplies its core pin, so no caller reaches into Web's files or silently uses HEAD.
build-web:
	MAP_DATA_ROOT="$$(node tools/pinned-data-root.mjs)" \
	MAP_CONTRACTS_ROOT="$$(node tools/pinned-contracts-root.mjs)" \
	$(MAKE) --no-print-directory -C $(ROOT)/apps/web build-pinned-core

test:
	cd $(ROOT) && node --test platform/tests/*.test.mjs

python-test:
	cd $(ROOT) && python3 -m unittest discover -s platform/tests -p 'test_*.py'

python-check:
	cd $(ROOT) && python3 -m py_compile platform/tools/*.py

agent-rules:
	cd $(ROOT) && node platform/agents/gen-agent-rules.mjs

worktree:
	cd $(ROOT) && sh platform/tools/worktree.sh $(NAME) $(BASE)

# make -C platform browser-image [IMAGE=browser-ci:local] [REVISION=<commit>]: build the browser test image and prove
# Chromium starts in it. REVISION labels the image with the commit it was built from when publishing passes one.
IMAGE ?= browser-ci:local
REVISION ?=
# The build's RUN steps download packages. They use the host's network because on GitHub runners the default build
# network stopped resolving names (apt-get: "Could not resolve 'archive.ubuntu.com'") while the host still could.
browser-image:
	docker build --network=host $(if $(REVISION),--label "org.opencontainers.image.revision=$(REVISION)") --tag $(IMAGE) browser-image
	docker run --rm $(IMAGE) node --print "process.version"
	docker run --rm $(IMAGE) python3 --version
	docker run --rm $(IMAGE) node --eval "require('playwright').chromium.launch().then(browser => browser.close())"
