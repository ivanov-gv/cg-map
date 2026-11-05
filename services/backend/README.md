# Backend

Ownership: backend/editorial team. An independent Go module using ConnectRPC and Protocol Buffers with one binary,
`cmd/server` ("Kompas"). It hosts the built web artifact and serves two APIs: map layers from the release PMTiles
archive, and live transport vehicles from ePodgorica. Its `config.json` tells the web app to use these APIs (server
mode). It is not an IAM service or editorial application. The published app on GitHub Pages runs without this server in
mock mode; see [web data modes](../../apps/web/README.md#data-modes).

## Run

`make dev` at the repository root builds the web artifact and runs this server on it (`DEV_FLAGS` passes extra flags).
Directly:

Requires Go 1.26 or newer (the module pins the development toolchain). From this directory, after building the web
artifact at the repository root (`make build`):

```sh
go run ./cmd/server -dir ../../dist/web                # archive: the single *.pmtiles in <dir>/data; open http://127.0.0.1:8080/
go run ./cmd/server -dir ../../dist/web -live-transport=false   # no upstream calls; vehicles answer 503
go run ./cmd/server -dir ../../dist/web -archive /data/montenegro-0123456789abcdef.pmtiles -listen 127.0.0.1:9000 -public-url https://maps.example.com
go vet ./...
make lint                                              # golangci-lint, pinned in the Makefile; part of make check
go test -count=1 -race ./...
```

The server fails to start if it cannot find exactly one archive. On SIGINT/SIGTERM it reports `/readyz` 503 while still
serving for `-shutdown-delay` (5 s), then closes the listener and drains in-flight requests for up to
`-shutdown-timeout` (10 s); a second signal exits immediately. If draining exceeds the timeout, remaining connections
are closed (their requests may fail) and the process exits 1, as it does for any startup or serve error. There is no
global write timeout, so large archive range downloads are not cut off. Behind a proxy, set `-public-url` so TileJSON
does not build tile URLs from the request's Host header.

With live transport enabled, the HTTP server starts immediately and observes vehicle movement in the background. The
map, layers, config and `/healthz` remain available during observation. `/readyz` and the vehicles endpoint return 503
with `Cache-Control: no-store` until two fresh position snapshots have been observed, about 13–14 seconds plus upstream
response time. Transport requests return immediately rather than waiting past the client's timeout. The first successful
vehicles response can carry movement directions without relying on the page's history. Vehicles that remain stationary
or appear only in the second snapshot still have no known direction.

An upstream failure is logged and retried in the background; it cannot block the HTTP listener. A failed refresh is
retried after 13 s, so after a failure readiness can take up to about 36 s from the upstream recovering, plus response
times. Startup readiness stays 503 until observation succeeds. After that, an upstream outage uses the usual
stale/expiry behavior without changing readiness. `-live-transport=false` skips observation and starts ready, with the
vehicles endpoint always unavailable.

### Redeployment

Keep the current instance serving while starting its replacement on another `-listen` port, with a separate release
directory passed through `-dir`. Build the binary and artifact before starting the replacement; keep the previous
release intact for rollback and existing archive requests.

1. Start the replacement while the current instance remains the proxy's upstream.
2. Wait for the replacement's `/readyz` to return 200. An open port or `/healthz` 200 is not sufficient: directions may
   still be unknown. If readiness fails or times out, leave traffic on the current instance.
3. Switch the reverse proxy to the replacement using its graceful configuration reload.
4. Send SIGTERM to the old instance and allow its configured shutdown delay and request drain to complete. Account for
   long archive downloads when choosing `-shutdown-timeout`.

This overlaps observation with normal service. A stop-then-start deployment still has a process replacement gap;
readiness alone does not keep an old instance running. The repository does not provision a backend reverse proxy or
process manager, so that switchover belongs to the hosting setup.

## HTTP interface

| Path                                                 | Response                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/layers`                                 | TileJSON 3.0.0 (cached 5 min): absolute tile URL template for the current release, zooms, bounds, center, `vector_layers` (land, water, roads, buildings) from the archive metadata                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `GET /api/v1/layers/{release}/tiles/{z}/{x}/{y}.mvt` | Mapbox vector tile. `{release}` is the content-addressed archive name without `.pmtiles`, so tiles are cached as immutable and a new data release changes every URL; an old release returns 404 (clients holding a TileJSON cached before a deploy may see 404s for up to its 5 minutes). Layers endpoints accept GET and HEAD; other methods get 405. Gzip as stored when the client accepts it, otherwise decompressed. 204 for an empty tile in range, 404 outside the archive's zooms or grid, 400 for malformed paths (including leading zeros), ETag/304 support                                                                                                                                                                                                                                                                                                                                             |
| `GET /api/v1/transport/vehicles`                     | Live ePodgorica positions in the [vehicles contract](../../packages/contracts/vehicles.schema.json), with the same upstream limits, normalization, 13 s cache, 60 s stale window, headers and 503 body as [transit-relay](../transit-relay/README.md). The server observes movement in the background, returning 503 until initial observation completes, then refreshes about every 13–14 s even without viewers; viewers share those refreshes (at most one upstream request per 13 s, including during an outage, when a failed refresh is retried only after 13 s; the relay retries on the next request). Refresh failures are logged, rate-limited to one line per minute. Vehicles seen moving between checks carry `bearing` and `heading: "movement"` ([direction rules](../../docs/ui-ux/features/transport.md#direction)). With `-live-transport=false` it always answers 503 "temporarily unavailable" |
| `GET /config.json`                                   | `{"api":"server"}`, no-store: makes the web app use these APIs instead of the artifact's static `config.json` (mock mode)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GET /healthz`, `GET /readyz`                        | Liveness (available during observation); readiness (503 during initial transport observation and once shutdown starts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| anything else under `/api`                           | JSON 404                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| everything else                                      | Files from `-dir`, with the static hosting headers (range requests for the archive)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Protobuf transport API

`cgmap.transport.v1.TransportService/ListVehicles` is the read-only ConnectRPC API. Its definition lives in
[the shared protobuf contract](../../packages/contracts/proto/cgmap/transport/v1/transport.proto); generated Go types,
handler registration and clients live in `gen/`. ConnectRPC replaces hand-written RPC routing and serialization. It uses
Go's HTTP server alongside the map's existing tile, asset and health handlers.

Requests use the Connect, gRPC or gRPC-Web protocol at `/cgmap.transport.v1.TransportService/ListVehicles`. Connect
supports binary protobuf and protobuf JSON. The listener accepts HTTP/1.1 and cleartext HTTP/2; behind a proxy,
configure its upstream protocol accordingly. The endpoint is same-origin with the map. Browser integration is deferred;
the existing `/api/v1/transport/vehicles` GeoJSON endpoint remains compatible and reads the same cache, direction
history and startup state. Neither interface triggers a separate upstream polling loop.

The response contains route, WGS84 longitude/latitude, optional movement direction, server check time, stale flag and
source URL. Direction is a message with presence: absent means unknown; a present `bearing_degrees: 0` means north.
There is no invented vehicle ID or GPS timestamp. During observation or after expiry, RPC callers receive `unavailable`;
within the stale window they receive the existing snapshot with `stale: true`. RPC responses use
`Cache-Control: no-store`. No live data is persisted.

### Regenerate bindings

Install Buf CLI 1.75.0 and use the backend module's pinned generators (ConnectRPC 2.0.2 and protobuf Go 1.36.11):

```sh
make -C services/backend generate
make -C services/backend generate-check
```

Run these from the repository root. `generate` lints the shared schema and writes `gen/`; `generate-check` generates
into a temporary directory and compares it with the committed bindings. Do not edit generated files. Regular Go builds
and tests consume those bindings and do not need Buf, Node, the shared proto sources or raw geography. The explicit
ConnectRPC dependency follows the requirement for a protobuf-defined server API; its Go 1.26 minimum is also the
module's minimum.

## Layout

- `cmd/server`: flags and graceful shutdown (`main.go`), wiring and routes (`app.go`).
- `internal/server/web`: static files, web config, health checks and the API 404.
- `internal/service/vehicles`: the live vehicle domain, with no HTTP or wire formats. `Feed` caches normalized
  snapshots, `Observer` keeps it refreshed and gates it until movement is known, and `direction.go` derives directions,
  mirroring apps/web/src/vehicle-direction.js (shared cases in packages/contracts/fixtures). Data comes from a
  `vehicles.Source`.
- `internal/client/epodgorica`: the live `vehicles.Source` (fixed upstream, no credentials, the relay's
  body/status/array checks). `vehicles.Unavailable` replaces it when live transport is off. Live positions are never
  written to disk; tests use local fakes, never the upstream.
- `internal/client/pmtiles`: read-only PMTiles v3 reader (header, metadata, tiles, leaf directories, gzip).
  `pmtilestest` builds synthetic archives for tests.
- `internal/server/transport`: publishes snapshots as the ConnectRPC API and the GeoJSON compatibility endpoint,
  including their protobuf and GeoJSON mapping.
- `internal/server/layers`: the layers API on top of the reader.

A service never imports a server package.

Future listing, editing/moderation, authentication, and online search capabilities belong here as concrete requirements
arrive. Public formats go in [contracts](../../packages/contracts/README.md). Do not add empty services.
