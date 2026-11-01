ROOT := ..

.PHONY: verify lint repo agents-check

verify: lint repo agents-check

lint:
	cd $(ROOT) && npx --no-install markdownlint-cli2 --no-globs 'docs/**/*.md'
	cd $(ROOT) && npx --no-install prettier --check --ignore-path .gitignore 'docs/**/*.md'

repo:
	cd $(ROOT) && npm run -s check:repo

agents-check:
	cd $(ROOT) && npm run -s check:agents