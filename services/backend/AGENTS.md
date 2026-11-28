# Backend module

Read [README.md](README.md). Run Go commands from services/backend or use make check-go at the repository root. This
module must remain independently buildable without raw geography, and its regular checks need no npm. Dev binding
generation reads this commit; `generate-check`, `generate-release` and `build-release` resolve the pinned contracts
package installed by `make setup` and refuse another root. The server serves an explicitly selected artifact directory
and the PMTiles archive inside it (or one passed with -archive); it does not embed web source. The vehicles endpoint
keeps services/transit-relay's normalization, cache and headers, except that a failed refresh is not retried for 13 s
(the relay retries on the next request), plus the optional movement `bearing`/`heading` the relay does not produce. Keep
direction.go in step with apps/web/src/vehicle-direction.js; the browser reads the pinned fixture and the Go test reads
a local copy that `tests/` verifies byte-for-byte against that pin. Tests never call the live upstream.

Transport RPCs use ConnectRPC v2 and the versioned protobuf from the shared contracts. Keep protocol mapping in
internal/server/transport; both APIs read the same `vehicles.Observer` until browser migration. Generated bindings in
gen/ are committed: use `make -C services/backend generate` and `generate-check` from the root (Buf 1.75.0); never edit
them manually. `tools/contracts-root.sh` owns contract resolution: dev generation reads this commit, while checks,
`generate-release` and `build-release` read the exact installed pin and refuse another root. Regular Go checks need no
installed package. The module pins the Go toolchain and generator dependencies. Test RPCs through the generated client
and Connect transport, including message presence for unknown versus northbound directions.
