# Map data

Ownership: map-data team. This npm workspace owns acquisition, source snapshots, provenance/quality, imagery, tile generation, and reviewed releases.

| Directory | Purpose |
| --- | --- |
| sources/ | Editable geometry, places, provenance and upstream metadata |
| imagery/podgorica/ | Bundled satellite sample with its own provenance |
| artifacts/ | Reviewed content-addressed archive and release.json |
| tools/ | Extraction, validation, tiling, packaging, release metadata |
| tests/ | Data contract tests and a small Podgorica fixture |

From repository root: `npm run check:data`. Full rebuild: `make build-data` after installing [optional Python dependencies](../docs/runbooks/data.md).

From this workspace: `npm run check`, `npm run build`, `npm test`. The full build is deliberately expensive. Viewing/building the web uses the committed reviewed archive instead.

Source provenance is described in [PROVENANCE.md](PROVENANCE.md). The data validator uses [shared contracts](../packages/contracts/README.md), never web implementation.
