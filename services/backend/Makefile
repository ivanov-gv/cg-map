ROOT := ../..

.PHONY: verify check format-check vet test build

verify: check

check: format-check vet test build

format-check:
	@unformatted=$$(gofmt -l .) && if [ -n "$$unformatted" ]; then echo "gofmt needed (run gofmt -w):" >&2; echo "$$unformatted" >&2; exit 1; fi

vet:
	go vet ./...

test:
	go test ./...

build:
	mkdir -p $(ROOT)/.build
	go build -o $(ROOT)/.build/kompas ./cmd/server