# Backend

Ownership: backend/editorial team. Today this independent Go module contains only the optional static HTTP host. It is not yet an API, IAM service, or editorial application.

From this directory, after building the web artifact at the repository root:

```sh
go run ./cmd/server -dir ../../dist/web
go vet ./...
go test ./...
```

Future listing, editing/moderation, authentication, and online search capabilities belong here as concrete requirements arrive. Keep commands in cmd/, internal implementation in internal/ when needed, and public formats in [contracts](../../packages/contracts/README.md). Do not add empty services or pretend the static host is a production backend.
