# Backend

Ownership: backend/editorial team. An independent Go module (standard library only) with one binary, `cmd/server`
("Kompas"). It hosts the built web artifact and serves two APIs: map layers from the release PMTiles archive, and live
transport vehicles from ePodgorica. Its `config.json` tells the web app to use these APIs (server mode). It is not an
IAM service or editorial application. The published app on GitHub Pages runs without this server in mock mode; see
[web data modes](../../apps/web/README.md#data-modes).

## Run

`make dev` at the repository root builds the web artifact and runs this server on it (`DEV_FLAGS` passes extra flags).
Directly:

From this directory, after building the web artifact at the repository root (`make build`):

```sh
go run ./cmd/server -dir ../../dist/web                # archive: the single *.pmtiles in <dir>/data; open http://127.0.0.1:8080/
go run ./cmd/server -dir ../../dist/web -live-transport=false   # no upstream calls; vehicles answer 503
go run ./cmd/server -dir ../../dist/web -archive /data/montenegro-0123456789abcdef.pmtiles -listen 127.0.0.1:9000 -public-url https://maps.example.com
go vet ./...
go test -count=1 -race ./...
```

The server fails to start if it cannot find exactly one archive. On SIGINT/SIGTERM it reports `/readyz` 503 while still
serving for `-shutdown-delay` (5 s), then closes the listener and drains in-flight requests for up to
`-shutdown-timeout` (10 s); a second signal exits immediately. If draining exceeds the timeout, remaining connections
are closed (their requests may fail) and the process exits 1, as it does for any startup or serve error. There is no
global write timeout, so large archive range downloads are not cut off. Behind a proxy, set `-public-url` so TileJSON
does not build tile URLs from the request's Host header.

## HTTP interface

| Path                                                 | Response                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/layers`                                 | TileJSON 3.0.0 (cached 5 min): absolute tile URL template for the current release, zooms, bounds, center, `vector_layers` (land, water, roads, buildings) from the archive metadata                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GET /api/v1/layers/{release}/tiles/{z}/{x}/{y}.mvt` | Mapbox vector tile. `{release}` is the content-addressed archive name without `.pmtiles`, so tiles are cached as immutable and a new data release changes every URL; an old release returns 404 (clients holding a TileJSON cached before a deploy may see 404s for up to its 5 minutes). Layers endpoints accept GET and HEAD; other methods get 405. Gzip as stored when the client accepts it, otherwise decompressed. 204 for an empty tile in range, 404 outside the archive's zooms or grid, 400 for malformed paths (including leading zeros), ETag/304 support                                                                                                                                                                                 |
| `GET /api/v1/transport/vehicles`                     | Live ePodgorica positions in the [vehicles contract](../../packages/contracts/vehicles.schema.json), with the same upstream limits, normalization, 13 s cache, 60 s stale window, headers and 503 body as [transit-relay](../transit-relay/README.md). With live transport on, the server refreshes it about every 13–14 s from startup, so directions are known before anyone opens the map; viewers share those refreshes (at most one upstream request per 13 s). Refresh failures are logged, rate-limited to one line per minute. Buses seen moving between checks carry `bearing` and `heading: "movement"` ([direction rules](../../docs/transport.md#direction)). With `-live-transport=false` it always answers 503 "temporarily unavailable" |
| `GET /config.json`                                   | `{"api":"server"}`, no-store: makes the web app use these APIs instead of the artifact's static `config.json` (mock mode)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET /healthz`, `GET /readyz`                        | Liveness; readiness (503 once shutdown starts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| anything else under `/api`                           | JSON 404                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| everything else                                      | Files from `-dir`, with the static hosting headers (range requests for the archive)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Layout

- `cmd/server`: flags, routing, health checks, graceful shutdown.
- `internal/pmtiles`: read-only PMTiles v3 reader (header, metadata, tiles, leaf directories, gzip). `pmtilestest`
  builds synthetic archives for tests.
- `internal/layers`: the layers API on top of the reader.
- `internal/transport`: the vehicles API. Data comes from a `transport.Source`: `EPodgorica` (fixed upstream, no
  credentials, the relay's body/status/array checks) or `Unavailable`. `direction.go` adds movement bearings and mirrors
  apps/web/src/vehicle-direction.js (shared cases in packages/contracts/fixtures). Live positions are never written to
  disk; tests use local fakes, never the upstream.

Future listing, editing/moderation, authentication, and online search capabilities belong here as concrete requirements
arrive. Public formats go in [contracts](../../packages/contracts/README.md). Do not add empty services.
