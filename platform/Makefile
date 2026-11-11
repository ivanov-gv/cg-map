ROOT := ..

.PHONY: verify lint markdown-check repo agents-check build-web test python-test python-check agent-rules worktree browser-image

verify: lint markdown-check repo agents-check build-web test python-test python-check

lint:
	cd $(ROOT) && npx --no-install eslint platform eslint.config.mjs

markdown-check:
	cd $(ROOT) && npm run -s lint:md

repo:
	cd $(ROOT) && npm run -s check:repo

agents-check:
	cd $(ROOT) && npm run -s check:agents

# The hosting tests run against the built web artifact, a listed contract.
build-web:
	$(MAKE) --no-print-directory -C $(ROOT)/apps/web build

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

# make -C platform browser-image [IMAGE=browser-ci:local]: build the browser test image and prove Chromium starts in it.
IMAGE ?= browser-ci:local
# The build's RUN steps download packages. They use the host's network because on GitHub runners the default build
# network stopped resolving names (apt-get: "Could not resolve 'archive.ubuntu.com'") while the host still could.
browser-image:
	docker build --network=host --tag $(IMAGE) browser-image
	docker run --rm $(IMAGE) node --print "process.version"
	docker run --rm $(IMAGE) python3 --version
	docker run --rm $(IMAGE) node --eval "require('playwright').chromium.launch().then(browser => browser.close())"
