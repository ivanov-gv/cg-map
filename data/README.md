# Map data

Ownership: map-data team. This npm workspace owns acquisition, source snapshots, provenance/quality, imagery, tile
generation, and reviewed releases.

| Directory          | Purpose                                                                             |
| ------------------ | ----------------------------------------------------------------------------------- |
| sources/           | Editable geometry, derived relief vectors, places, levels, provenance, and metadata |
| imagery/podgorica/ | Bundled satellite sample with its own provenance                                    |
| artifacts/         | Reviewed content-addressed archive and release.json                                 |
| tools/             | Extraction, validation, tiling, packaging, release metadata                         |
| tests/             | Data contract tests and a small Podgorica fixture                                   |

From repository root: `make -C data check`. Local `make verify PKG=data` and full rebuilds need the pinned Python
requirements in `tools/requirements.txt`; install them in a virtualenv as described in the
[data runbook](../docs/runbooks/data.md#geometry-edits-or-refreshes). CI installs the same requirements before data
verification; tests are not skipped when `osmium` is missing.

Full rebuild: `make -C data build-data`. The five relief sources are rebuilt separately with
`make -C data build-relief PYTHON=~/.cache/cg-map/venv/bin/python` after installing the pinned GIS packages in that
venv; their raster inputs and derivation report stay outside Git, and their vectors, counts and hashes are reviewed
here.

From this workspace: `npm run check`, `npm run build`, `npm test`. The full build is deliberately expensive.
Viewing/building the web uses the committed reviewed archive instead. The reviewed data is also published as
[`@ivanov-gv/map-data`](../docs/runbooks/release.md#releasing-map-data) for app tests.

## Published vector layers

`data/tools/tile-layers.mjs` is the one definition of the archive's layers. The tile builder selects and filters source
fields with it, writes the same table to `.build/tiles/layer-metadata.json`, and `data/tools/pack.py` copies that
generated table into the archive's `vector_layers` metadata. No second layer list is maintained in Python.

The layers, their source files, zooms and fields are listed once, in the
[archive layers table](../docs/runbooks/data.md#archive-layers).

Low zooms stay light: paths and footways are withheld below zoom 14, minor summits and unnamed settlements appear only
at their detail zooms, and road nodes and entrances are detail-only. Turn restrictions are topological relations, and
transit routes are ordered stop lists with directions; neither is display geometry, so both remain JSON sources rather
than tile layers. Full building tags stay in `buildings.geojson` for the editor; the archive carries only `kind` and
`building:levels`.

Source provenance is described in [PROVENANCE.md](PROVENANCE.md). The data validator uses
[shared contracts](../packages/contracts/README.md), never web implementation.

`check-data` also validates the [source entity contract](../packages/contracts/README.md#source-entity-identity) in the
adopted source GeoJSON files. The extractor writes one feature per line, sorted by entity ID, part and canonical bytes;
extracted OSM coordinates use six decimals. Preserved snapshots keep their published precision and source-specific IDs.
Importer-added features receive a `local:<uuid>` identity and a content version. See the contract for the ID namespaces
and the meaning of a content version.
