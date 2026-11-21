# Map data

Ownership: map-data team. This npm workspace owns acquisition, source snapshots, provenance/quality, imagery, tile
generation, and reviewed releases.

| Directory          | Purpose                                                     |
| ------------------ | ----------------------------------------------------------- |
| sources/           | Editable geometry, places, levels, provenance, and metadata |
| imagery/podgorica/ | Bundled satellite sample with its own provenance            |
| artifacts/         | Reviewed content-addressed archive and release.json         |
| tools/             | Extraction, validation, tiling, packaging, release metadata |
| tests/             | Data contract tests and a small Podgorica fixture           |

From repository root: `make -C data check`. Local `make verify PKG=data` and full rebuilds need the pinned Python
requirements in `tools/requirements.txt`; install them in a virtualenv as described in the
[data runbook](../docs/runbooks/data.md#geometry-edits-or-refreshes). CI installs the same requirements before data
verification; tests are not skipped when `osmium` is missing.

From this workspace: `npm run check`, `npm run build`, `npm test`. The full build is deliberately expensive.
Viewing/building the web uses the committed reviewed archive instead. The reviewed data is also published as
[`@ivanov-gv/map-data`](../docs/runbooks/release.md#releasing-map-data) for app tests.

Source provenance is described in [PROVENANCE.md](PROVENANCE.md). The data validator uses
[shared contracts](../packages/contracts/README.md), never web implementation.

`check-data` also validates the [source entity contract](../packages/contracts/README.md#source-entity-identity) in the
adopted source GeoJSON files. The extractor writes one feature per line, sorted by entity ID, part and canonical bytes;
extracted OSM coordinates use six decimals. Preserved snapshots keep their published precision and source-specific IDs.
Importer-added features receive a `local:<uuid>` identity and a content version. See the contract for the ID namespaces
and the meaning of a content version.
