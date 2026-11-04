ROOT := .

.PHONY: verify lint repo agents-check

verify: lint repo agents-check

lint:
	npx --no-install markdownlint-cli2 --no-globs 'docs/**/*.md'
	npx --no-install prettier --check --ignore-path .gitignore 'docs/**/*.md'

repo:
	npm run -s check:repo

agents-check:
	npm run -s check:agents