# Testing

## Commands

```sh
make setup
make check
npx playwright install chromium
make test-e2e
make check-go
```

## Test ownership

| Location | Scope |
| --- | --- |
| apps/web/tests | Pure search helpers, offline transactions, worker lifecycle, shipped vendor contracts |
| data/tests | Place/geometry contracts and approved small fixture |
| platform/tests | Actual Python HTTP/range behavior, deployment compatibility |
| services/backend/cmd/server | Go host directory/range behavior |
| tests/integration | Real archive/MVT decoding, style/glyph coverage, imagery, shared-category agreement, transport |
| tests/e2e | Built artifact, desktop/mobile, origin/project-prefix URLs, real offline download/reload |

make check builds dist/web and runs 35 Node tests, five Python tests, lint, data/provenance/release checks, docs/layout/dependency checks, and generated manifest verification. The backend workflow independently runs Go vet, tests, and build.

Playwright runs against the actual deployable artifact. It tests / and /cg-map/, fixture-backed search/selection, satellite switching with one map instance, and downloading/reloading the reviewed archive offline. Compatibility tests preserve old /web/ entry behavior. On failure, traces/screenshots are uploaded by CI.

These checks do not prove GIS topology, real-world listing freshness, phone GPU performance, or persistent storage retention. Test the target phone for gestures, rotation/folding, interrupted/full-storage downloads, airplane-mode reopening, eviction, and long-running memory/frame behavior.

The detailed earlier design guide includes historical verification evidence. Current commands, ownership, and CI are authoritative for this layout.

## Monorepo verification — 2026-10-18

Executed locally: 35 Node tests, five Python tests, six Playwright tests, lint, source/release/contract validation, documentation/boundary checks, offline manifests, and both workspace-local test commands. The full geography pipeline was not rerun: source geometry and archive bytes were moved unchanged. Backend Go checks and the actual Pages deployment are verified by their GitHub workflows.

Transport feature verification: relay/cache/stale lifecycle unit tests, client late-response/expiry tests, desktop/mobile toggling and failure/offline acceptance. The public hosted relay returned actual upstream positions with anonymous access and public read CORS. Browser acceptance uses deterministic responses; live integration is smoke-tested separately.

Route planning: provider tests block service workers so the offline shell cannot substitute the real network for deterministic fixtures. Car/foot profiles, validation, cached/cancelled requests, direct and one-transfer bus search, mode switching, missing routes, identical points and clearing are covered. The separate offline acceptance test uses the actual bundled bus network and cached map. Live provider smoke tests are separate from mocked browser acceptance.
