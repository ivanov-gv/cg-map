.PHONY: setup dev check test test-e2e build pages check-go
setup:
	npm ci --ignore-scripts

dev:
	python3 tools/serve.py --port $${PORT:-8080}

check:
	npm run check

test:
	npm test
	python3 -m unittest discover -s tests -p 'test_*.py'

test-e2e:
	npm run test:e2e

# Full geography rebuild requires the optional Python build environment.
build:
	npm run build

pages:
	npm run release:prepare

check-go:
	mkdir -p .build
	go vet ./...
	go test ./...
	go build -o .build/kompas ./cmd/kompas
