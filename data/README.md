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

From repository root: `make -C data check`. Full rebuild: `make -C data build-data` after installing
[optional Python dependencies](../docs/runbooks/data.md).

From this workspace: `npm run check`, `npm run build`, `npm test`. The full build is deliberately expensive.
Viewing/building the web uses the committed reviewed archive instead.

Source provenance is described in [PROVENANCE.md](PROVENANCE.md). The data validator uses
[shared contracts](../packages/contracts/README.md), never web implementation.

`check-data` also validates the additive
[source entity contract](../packages/contracts/README.md#source-entity-identity) in every source GeoJSON file. Adoption
is explicit per collection; the current reviewed snapshots remain unannotated. It checks ID namespaces, base-version
types and split-part uniqueness without assigning identities to legacy geometry or changing provenance. See the contract
for the staged migration and the meaning of a content version.
