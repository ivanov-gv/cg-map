# Data contracts and pipeline

## Sources and releases

- Geometry, places, settlements and municipality borders: data/sources/.
- Reviewed counts, SHA-256, snapshot timestamp, coverage: data/sources/provenance.json.
- Place contract: [places.schema.json](../../packages/contracts/places.schema.json).
- Source context: [PROVENANCE.md](../../data/PROVENANCE.md).
- Imagery: [Podgorica sample](../../data/imagery/podgorica/README.md).
- Reviewed basemap: data/artifacts/, selected by release.json with bytes and SHA-256.

make -C data check validates supported geometry structure, WGS84 ranges, polygon closure, place
IDs/names/categories/levels, provenance, and the recorded release checksum. It is not GIS topology validation or a
guarantee that business listings are current. make -C data check-topology adds the Shapely-backed municipality,
shared-edge and settlement checks; make verify PKG=data and make -C data verify run both groups.

## Place-only edits

Edit data/sources/places.geojson, review attribution and place count in provenance, then assign levels and record the
reviewed change:

```sh
node data/tools/apply-place-visibility.mjs --contracts-directory packages/contracts --update-provenance --accept-new-facts
make -C data check
make check
make test-e2e
```

The data tools take the shared contracts directory from their caller; the published data package does not contain it.
The web build incorporates the new directory and regenerates offline manifests in dist/web. Do not regenerate vector
tiles for a place-only change. If changing release-level timestamp/coverage deliberately, regenerate
data/artifacts/release.json with node data/tools/finalize-archive.mjs as well.

## Place visibility levels

[Stable POI visibility](../ui-ux/features/poi-visibility.md) gives each place a fixed level. The zoom table is
[place-visibility.json](../../packages/contracts/place-visibility.json). Assignments live in
data/sources/place-visibility-policy.json, separate from OSM facts. Precedence is active ID override, kind rule,
category default, then `fallbackLevel`. Places with a missing kind take the fallback. See
[ADR 0027](../decisions/0027-place-categories-and-standalone-points.md) for which OSM kinds are extracted and which are
excluded as category gaps.

To change an assignment, edit the policy, then:

```sh
node data/tools/apply-place-visibility.mjs --contracts-directory packages/contracts --update-provenance
make -C data check
```

Then review density on real data. From apps/web, this saves screenshots at every threshold to test-results/:

```sh
POI_DENSITY_SCREENSHOTS=1 npm run test:e2e -- --grep 'density review'
```

The command only writes `visibilityLevel`. `places_facts_sha256` in provenance hashes the snapshot without that field,
so a level change cannot hide a coordinate or attribute change. With `--update-provenance`, the command refuses changed
facts unless you also pass `--accept-new-facts` after reviewing them. Without that flag it leaves provenance alone, and
`make -C data check` fails until levels, policy, and provenance agree.

Place facts include `name`, `name:en`, `name:sr-Latn`, `phone` (from `phone` or `contact:phone`), `website` (from
`website` or `contact:website`), `email` (from `email` or `contact:email`), `opening_hours` (OSM format), `wheelchair`,
`addr:street`, `addr:housenumber`, `level`, `cuisine`, `wikidata`, `wikipedia`. The `contact:*` keys normalise onto the
plain key only when the plain key is absent. Standalone points (historic, tourism, amenity, and `man_made=tower` or
`man_made=lighthouse`) receive `standalone: true` when not inside a building footprint.

Each override needs `id`, `level`, `reason`, `active`, and `provenance` (`basis`, `reviewedBy`, `reviewedAt`). Unknown
or duplicate IDs and unsupported levels are rejected. Level 1 is reserved for editorially reviewed places in the sights
category; kind and category rules cannot assign it. `basis: "commercial"` entries must stay `active: false`: paid
placement is not part of this release.

data/tools/extract-osm.py replaces places.geojson and then reapplies the policy, so overrides survive an import. An
override whose place disappeared stops that step with an error. `--source-url` and `--source-date` are required on every
run, including partial ones, so provenance records the exact reviewed input. The `--layers` groups are `buildings`, `roads`, `water`, `land` (land.geojson, including its country geometry),
`borders` (border-edges.geojson and municipalities.geojson), `settlements`, and `places`; each group replaces only its
own source files. A partial run must use the PBF whose SHA-256 is in provenance.json; a different input fails and asks
for a full extract. The `buildings` group writes both `buildings.geojson` and `building-entrances.geojson`, and supplies
footprint geometry to a `places` group in the same run for its `buildingEntityId` joins. Run both groups together when
refreshing either side of that join; this Feature does not refresh places, so the published snapshot has no such joins.
`context-countries.geojson` is a preserved input to the land and water layers, refreshed only on a full run. Fix the
policy, then review the new facts as above.

The extractor applies the reviewed visibility policy without updating provenance, so `make -C data check` fails when an
import changes place facts. Review the diff and then pass `--accept-new-place-facts` to a new extract, or run the
place-only command above with `--update-provenance --accept-new-facts`. Never pass that flag just to turn a check green.

## Building attributes and entrances

The reviewed extract copies OSM building tags into `buildings.geojson`, folds only case and whitespace when joining
`addr:street` to one connected group of same-named road ways, names the group's lowest way ID in `addr:streetEntityId`,
lists all its members in `addr:streetEntityIds`, and records no-number placeholders as `nohousenumber: "yes"`. It also
writes `building-entrances.geojson`, a read-only source of OSM entrance nodes near published footprints. It can add
`buildingEntityId` to places inside those footprints when the `places` group is refreshed with `buildings`; this Feature
keeps the reviewed places snapshot from the branch below, so no published place carries that join. The version-2 editor
bundle lists the new entrance, settlement, municipality and shared-border files; the editor can inspect them but cannot
change them, and still accepts a version-1 bundle with the original eight files. The separate `entrances` array in
`building-labels.geojson` remains the runtime arrow/label format and is not generated from this source file. See
[building addresses](../map-data/building-numbers.md), [decision 0023](../decisions/0023-osm-building-source-details.md)
and [decision 0024](../decisions/0024-editor-bundle-versions.md).

Review the counts in `provenance.json` under `building_details` and the footprint SHA-256 in
`building-labels.provenance.json` after any building or place extraction. `make verify PKG=data` compares the reviewed
counts and footprint SHA-256 in its data tests; `make -C data check` validates source structure, hashes, and that every
street join lists every published road with the same name, with its lowest way ID as the representative. A geometry
change still needs the full archive rebuild below; an attribute-only refresh leaves tile geometry unchanged and needs no
archive rebuild.

## Settlements and shared municipality edges

The `settlements` and `borders` groups write `settlements.geojson`, `border-edges.geojson` and `municipalities.geojson`
from the reviewed PBF. They are read-only in the editor: refresh them with a full extract or the named `--layers`
groups, never with a changeset. The shared-edge construction and simplification rule are recorded in
[decision 0024](../decisions/0024-shared-border-edges.md).

```sh
python3 data/tools/extract-osm.py <reviewed-pbf> --root . --layers borders settlements \
  --source-url https://download.geofabrik.de/europe/montenegro/montenegro-latest.osm.pbf \
  --source-date 2026-11-21
make -C data check-topology
make verify PKG=data
```

The topology command checks polygon validity, zero-area pairwise intersections, land coverage, edge use from both sides,
settlement counts and the combined 5 MB budget. It separates the measured inland-water gap from any unexplained gap and
fails when the unexplained gap exceeds the named tolerance. On the reviewed 2026-11-21 extract it reports 25
municipalities, 113 edges and 4,009 settlements. The new sources are not inputs to the tile builder, so their first
release did not change the reviewed archive; a refresh of land, water, roads or buildings still follows the rebuild path
below. Existing town labels are compared with the new settlement source in
[hard-coded town coverage](../map-data/hard-coded-towns.md).

## Editor changesets

The [source editor](../../apps/editor/README.md) exports changesets; only the data-owned importer writes sources:

```sh
make -C data apply-changeset CHANGESET=/absolute/path/to/changeset.json
git diff data/sources
make -C data check
```

The importer checks everything before the first write: version, base hashes, fingerprints, allowed operations and
properties, geometry and label joins. It then stages its writes, and restores the reviewed files if the final data check
fails. It never commits. A level edit becomes a policy override, so regenerating levels keeps it, and each change is
recorded with its author, reason and both values in data/sources/editor-corrections.json; see
[provenance](../../data/PROVENANCE.md). New features use a `local:` reference and claim nothing the rules do not list; a
new place also takes the contract's local source value, never a fabricated upstream ID. In an adopted collection the
importer assigns the addition a fresh `local:<uuid v4>` source identity and a `sha256:` base version; a changeset must
not claim those fields. An edit or deletion that would replace or remove a commercial override is refused by name:
review it in the policy first.

The command says whether a tile rebuild is needed. POI and label changes follow the source validation and web-build
path; geometry changes need an intentional `make -C data build-data` and a release review. A drawn road changes the
display map only, not external car or foot routing.

## Place fixture

The small approved fixture is data/tests/fixtures/podgorica-places.geojson. Keep expected behavior explicit when
changing it. Browser tests also exercise the actual reviewed archive and imagery.

## Green areas and water extraction

The `land` layer publishes named kinds and the OSM tag that selected each one. When an object carries several candidate
tags, the first rule in `data/tools/osm_extract/land.py` wins. Only a land-cover tag creates a feature: a protected-area
boundary or `place=locality` alone is not green cover. A meadow or grass area gets `destination: true` when it is named,
is mapped as a common (`leisure=common`), or contains a named place, POI or peak node in the detail box. Green
multipolygons keep their holes.

The `water` layer publishes lake, river, reservoir, pond, basin and generic water areas. River and canal lines stay
countrywide; stream, ditch and drain lines are clipped to the detail box and gain `entityPart` when clipped. Waterway
and coastline features retain upstream node order; `name` and `name:en` are copied only when mapped and nonblank, while
`tunnel` and `intermittent` are copied when mapped. Coastline lines are features in `water.geojson`, not a separate
source file, and consumers exclude them from the waterway stroke so the ocean fill shows the shore. The derived
`derived:ocean` polygon is still computed from the reviewed land outline and the OSM coastline.

Extracted green and water polygons are written with counterclockwise exteriors and clockwise holes. Preserved country
and context outlines keep their source winding. `make -C data check` enforces the shared kind enums, requires `osmTag`
on extracted features, and checks new property shapes and generated ring order.
`tests/integration/land-water-kinds.test.mjs` also checks that those enums stay in step with the editor rules, shared
fill expression and web selection fallbacks; run it with `make verify PKG=tests`. After changing extraction rules, run:

```sh
python3 -m unittest discover -s data/tests -p 'test_osm_extract.py'
make -C data check
make verify PKG=tests
```

A refresh that changes geometry also follows the intentional
[rebuild and release procedure](#geometry-edits-or-refreshes).

## Geometry edits or refreshes

`make verify PKG=data` and `make -C data build-data` need the pinned Python packages in `data/tools/requirements.txt`
(`pmtiles`, `shapely` and `osmium`). Use a virtualenv:

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r data/tools/requirements.txt
```

When the system Python has no `ensurepip`, create the environment without it and install into that interpreter:

```sh
python3 -m venv --without-pip .venv
python3 -m pip --python .venv/bin/python install -r data/tools/requirements.txt
. .venv/bin/activate
```

CI installs the same pinned requirements before running `make verify PKG=data`; tests are never skipped when `osmium` is
absent.

### Full OSM refresh

Keep the exact PBF outside Git. From the repository root, with the virtualenv active:

```sh
python3 data/tools/extract-osm.py /path/to/montenegro-2026-11-21.osm.pbf \
  --root . \
  --source-url https://download.geofabrik.de/europe/montenegro/montenegro-latest.osm.pbf \
  --source-date 2026-11-21 \
  --source-timestamp 2026-11-20T21:21:21Z \
  --detail-bbox 19.15 42.37 19.34 42.51
python3 data/tools/build-building-labels.py /path/to/montenegro-2026-11-21.osm.pbf
make -C data build-data
make -C data check
make check
make test-e2e
```

The extractor computes all outputs before replacing reviewed files. It applies the existing visibility policy but does
not accept changed place facts: review the diff, then either rerun the extract with `--accept-new-place-facts` or follow
the place-only procedure above. Only that deliberate review may update the place provenance hashes. Omit
`--source-timestamp` when the PBF header carries its replication time, and omit `--detail-bbox` for the reviewed box.

For a reviewed partial refresh, add the same required source options and restrict the run, for example
`--layers buildings roads`. It must use the PBF hash already in provenance.json; a different input is refused. Without
`land` in the selection, water's ocean polygon is recomputed from the reviewed land.geojson rather than a fresh country
outline. Finish with `make -C data build-data` when geometry changed, then the same checks.

make -C data build-data clips/encodes MVT into .build/tiles, packages PMTiles into data/artifacts, and writes
checksummed release metadata. It can create about 230K temporary files and need around 1 GB of space. It does not
deploy. Upstream extraction replaces snapshots rather than merging local corrections. Preserve original inputs outside
Git and provenance before refreshing. Do topology checks with GIS tooling. Data producers must not import UI/backend
implementation.

Current artifacts are committed for convenient clean-checkout builds. Move large/frequent releases to immutable artifact
storage when needed; local tooling is not a production archive retention policy.
