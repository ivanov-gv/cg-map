.PHONY: setup dev check test test-e2e build build-web build-data pages check-go
setup:
	npm ci --ignore-scripts

dev: build-web
	python3 platform/tools/serve.py --port $${PORT:-8080}

check:
	npm run check

test: build-web
	npm test
	python3 -m unittest discover -s platform/tests -p 'test_*.py'

test-e2e:
	npm run test:e2e

build: build-web

build-web:
	npm run build:web

# Expensive geography regeneration; requires data/tools/requirements.txt.
build-data:
	npm run build:data

pages: build-web

check-go:
	cd services/backend && go vet ./...
	cd services/backend && go test ./...
	mkdir -p .build
	cd services/backend && go build -o ../../.build/kompas ./cmd/server
