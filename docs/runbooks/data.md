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

## Relief sources

Five vectors are derived from local Copernicus DEM GLO-30 tiles, the reviewed OSM PBF, and the reviewed
`land.geojson`/`water.geojson`. Install the pinned GIS dependencies in a dedicated cache venv, then build with that
interpreter:

```sh
python3 -m venv ~/.cache/cg-map/venv
python3 -m pip --python ~/.cache/cg-map/venv/bin/python install -r data/tools/requirements.txt
make -C data build-relief PYTHON=~/.cache/cg-map/venv/bin/python
make -C data check
```

`make -C data build-relief` (see [ADR 0030](../decisions/0030-relief-derived-read-only-sources.md)) defaults to
`PYTHON=python3` and fails visibly if the chosen interpreter lacks the pinned GIS packages. `make verify PKG=data`
includes GIS-backed Python tests, so run it with the pinned venv on `PATH` (for example
`PATH=$HOME/.cache/cg-map/venv/bin:$PATH make verify PKG=data`). CI installs `data/tools/requirements.txt` and runs
those checks; it does not run the external DEM/PBF rebuild. The builder verifies DEM and PBF SHA-256 values before
deriving anything. `RELIEF_DEM_DIR`, `RELIEF_OSM_PATH`, and `RELIEF_OSM_SHA256` can point a disposable build at another
reviewed snapshot; the committed build records the exact inputs. The raster tiles, PBF and `.build/relief-report.json`
stay outside Git. Outputs are deterministic bytes: run the build twice and compare their hashes before committing a
source change.

Summits are clipped to the `kind=country` boundary in `land.geojson`: both the OSM point and its published six-decimal
coordinate must be inside or on the boundary. A point that rounds across the boundary in either direction is dropped.
Each summit carries `heightCheck`: `missing` when OSM has no elevation, `mismatch` only when a closed contour enclosing
the summit is above OSM height or the OSM/DEM difference exceeds 25 m, and `ok` otherwise. The per-summit result lives
on the feature; the report in `.build` adds the full mismatch list and build inputs. Contours are 20 m apart with 100 m
index lines, one `LineString` per connected line, checked against crossing contours before publication. Each contour
runs with higher ground on its left, judged on the smoothed grid it was traced from, so a label along it reads facing
uphill. `make -C data check` judges every closed contour that has a ring one interval inside it or a summit inside it
(`data/tools/relief-directions.mjs`); lines cut open by the detail area's edge are covered by the builder's test.

Slopes are one `Polygon` per connected light class inside the reviewed green areas. A ridge is the shared boundary
between adjacent sunlit and shaded slope polygons: one simplified, connected `LineString` per boundary, dropping pieces
under 100 m. A summit is linked through `summit`/`summitName` only when the final ridge passes within 50 m of it; an
unlinked ridge has no summit fields. Canyon rims are one `LineString` per segment with numbered `entityPart` values on
one derived identity; gaps under 60 m on one bank are joined before parts under 100 m are dropped. Every rim runs with
the river on its right, OSM cliffs included: the nearest river line decides, because a style offsets the canyon wall
from the rim toward the water. Derived IDs are deterministic for the pinned inputs but are not stable across a DEM or
green-area change.

Canyon rims keep only samples where the bank rises at least 8 m above the river surface within 60 m of the channel
(`CANYON_BANK_RISE_METRES` and `CANYON_SEARCH_DISTANCE_METRES` in `data/tools/relief/terrain.py`). The thresholds
exclude ordinary shallow banks; a 30 m DEM cannot reliably separate smaller rises from bank roughness. The join and
minimum-length constants in the same module exist because a 60 m gap is usually one bad pixel or small bend, while a
sub-100 m line after joining reads as speckle. Slope aspect and flat-ground rules live in that module too, with unit
tests run by plain `python3`. Green kinds come from the single `GREEN_KINDS` constant in
`data/tools/relief/derivations.py`, aligned with the land-kind enum in `source-land-water.schema.json`; eight of the
nine configured kinds occur in the current `land.geojson` (`garden` is absent). Green kinds, minimum slope area, the
retired ridge radius, layer sources and the ridge/rim thresholds are recorded in the `relief` block of
`data/sources/provenance.json`; features carry object facts only.

Relief files are not editing modes. `data/tools/editor-bundle.mjs` filters the bundle to the versioned exact file set in
`editor-bundle.schema.json` (version 2: thirteen files), so adding a relief source must not change browser editing
tests. See [data licensing](../map-data/data-license.md) for the required Copernicus attribution.

## Archive layers

`make -C data build-data` encodes one vector layer per published source. `data/tools/tile-layers.mjs` is the single
definition of each layer's source, fields and zoom ladder; the builder emits it to `.build/tiles/layer-metadata.json`,
and `data/tools/pack.py` writes that table as the archive's `vector_layers` metadata. Do not add a second hand-written
layer list to the packager. The builder derives one field that no source stores: `roads.inGreenArea` is `true` for a
walking path whose midpoint lies inside a green land area (`data/tools/green-areas.mjs`, green kinds from the relief
build parameters), so a style can draw park routes apart from city footpaths. The `green_area_labels` layer is derived
too: one line along the long side of each named green area, from its smallest enclosing rectangle
(`data/tools/green-area-labels.mjs`), for the area's name, plus one per named protected area whose name no green area
already shows.

| Layer             | Source file                                         | Zooms                                         | Fields                                                                                                                        |
| ----------------- | --------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| land              | `land.geojson`                                      | 0–17                                          | `kind`, `name`, `name:en`, `destination`                                                                                      |
| water             | `water.geojson`                                     | 0–17                                          | `kind`, `name`, `name:en`, `tunnel`                                                                                           |
| roads             | `roads.geojson`                                     | 0–17                                          | `kind`, `name`, `name:en`, `bridge`, `tunnel`, `layer`, `oneway`, `pathClass`, `lit`, `startLevel`, `endLevel`, `inGreenArea` |
| buildings         | `buildings.geojson`                                 | 13–17                                         | `kind`, `building:levels`                                                                                                     |
| contours          | `contours.geojson`                                  | index 12–13, all lines 14–17                  | `elevation`, `index`                                                                                                          |
| slopes            | `slopes.geojson`                                    | 12–17                                         | `aspect`                                                                                                                      |
| ridges            | `ridges.geojson`                                    | 14–17                                         | `sunlitSide`, `shadedSide`, `summitName`                                                                                      |
| canyon_rims       | `canyon-rims.geojson`                               | 13–17                                         | `river`, `bank`                                                                                                               |
| summits           | `summits.geojson`                                   | named 9–12, all 13–17                         | `name`, `name:en`, `ele`, `demElevation`, `heightCheck`                                                                       |
| protected_areas   | `protected-areas.geojson`                           | 10–17                                         | `kind`, `name`, `name:en`                                                                                                     |
| green_area_labels | `land.geojson`, `protected-areas.geojson` (derived) | 13–17                                         | `name`, `name:en`                                                                                                             |
| settlements       | `settlements.geojson`                               | capital/city 5, town 8, village 11, others 13 | `name`, `name:en`, `rank`                                                                                                     |
| borders           | `border-edges.geojson`                              | 6–17                                          | `left`, `right`                                                                                                               |
| municipalities    | `municipalities.geojson`                            | 8–17                                          | `name`, `name:en` (label point, not the polygon)                                                                              |
| road_nodes        | `road-nodes.geojson`                                | 16–17                                         | `kind`, `name`                                                                                                                |
| entrances         | `building-entrances.geojson`                        | 16–17                                         | `entrance`, `ref`, `level`, `door`, `wheelchair`                                                                              |

The table lists the fields written into tiles, not every source tag. Index contours start at zoom 12 and all contour
lines at 14; named summits start at 9 and minor ones at 13; settlement ranks enter at 5, 8, 11 and 13. Paths and
footways stay hidden below zoom 14. Turn restrictions and transit routes are topological relations and ordered stop
lists, not display geometry, so they stay JSON sources. Full building attributes stay in the source for the editor;
tiles carry only `kind` and levels.

Change a source in this table, or a field or zoom rule, and rebuild the archive before reviewing the release. The build
reports encoded bytes per layer and zoom band; if the release exceeds 45 MB, raise the relevant minimum zoom or simplify
that layer rather than dropping its metadata. Archive acceptance checks the zooms and fields against the same definition
in `tests/integration/archive-layers.test.mjs`.

The pre-push hook's root `make check` is required (builds and non-browser checks, no browser suites); `make test-e2e` is
an optional local check for iterating. A PR merges only when its tests pass on GitHub: its PR run (`CI gate`), or a
`workflow_dispatch` of the pipelines `make ci-plan BASE=origin/main` selects, on the branch:
[the rule](../../.github/TESTING.md).

## Place-only edits

Edit data/sources/places.geojson, review attribution and place count in provenance, then assign levels and record the
reviewed change:

```sh
node data/tools/apply-place-visibility.mjs --contracts-directory packages/contracts --update-provenance --accept-new-facts
make -C data check
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
run, including partial ones, so provenance records the exact reviewed input. The `--layers` groups are `buildings`,
`roads`, `water`, `land` (land.geojson, including its country geometry), `borders` (border-edges.geojson and
municipalities.geojson), `settlements`, `places`, and `protected-areas` (protected-areas.geojson); each group replaces
only its own source files. A partial run must use the PBF whose SHA-256 is in provenance.json; a different input fails
and asks for a full extract. The `buildings` group writes both `buildings.geojson` and `building-entrances.geojson`, and
supplies footprint geometry to a `places` group in the same run for its `buildingEntityId` joins. Run both groups
together when refreshing either side of that join; this Feature does not refresh places, so the published snapshot has
no such joins. A `borders` run uses reviewed `land.geojson` as its country outline; a `settlements` run uses reviewed
`municipalities.geojson` to assign each point. Run them together when refreshing either source.
`context-countries.geojson` is a preserved input to the land and water layers, refreshed only on a full run. Fix the
policy, then review the new facts as above.

The extractor applies the reviewed visibility policy without updating provenance, so `make -C data check` fails when an
import changes place facts. Review the diff and then pass `--accept-new-place-facts` to a new extract, or run the
place-only command above with `--update-provenance --accept-new-facts`. Never pass that flag just to turn a check green.

## Building attributes and entrances

The reviewed extract copies OSM building tags into `buildings.geojson`, folds only case and whitespace when joining
`addr:street` to one connected group of same-named road ways, names the group's lowest way ID in `addr:streetEntityId`,
lists all its members in `addr:streetEntityIds`, and records no-number placeholders as `nohousenumber: "yes"`. It also
writes `building-entrances.geojson`, the OSM entrance nodes near published footprints. It can add `buildingEntityId` to
places inside those footprints when the `places` group is refreshed with `buildings`; this Feature keeps the reviewed
places snapshot from the branch below, so no published place carries that join. The version-2 editor bundle lists the
new entrance, settlement, municipality and shared-border files; the editor can inspect them but cannot change them, and
still accepts a version-1 bundle with the original eight files. The separate `entrances` array in
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
from the reviewed PBF. Refresh them with a full extract or the named `--layers` groups. The editor corrects them with
changesets, and a refresh keeps those corrections with `make -C data reapply-corrections`. The shared-edge construction
and simplification rule are recorded in [decision 0028](../decisions/0028-shared-border-edges.md); the current gap
partition rule is in [decision 0029](../decisions/0029-derived-unassigned-water-areas.md).

```sh
python3 data/tools/extract-osm.py <reviewed-pbf> --root . --layers borders settlements \
  --source-url https://download.geofabrik.de/europe/montenegro/montenegro-latest.osm.pbf \
  --source-date 2026-11-21
make -C data check-topology
make verify PKG=data
```

The topology command checks polygon validity, zero-area pairwise intersections, land coverage, polygon reconstruction
from traversal-ordered edge references, edge use from both sides, settlement counts, the derived-water kind and the
combined 5 MB budget. Exterior sides come from matched OSM coastline or `admin_level=2` way tags, with over 0.1% segment
overlap so an endpoint touch cannot claim an edge; a boundary chain splits where supported coverage intervals of
different authorities end and begin together. It compares the published area union with the country outline without
subtracting water: internal gaps larger than 100 m² and exterior water larger than 1,000,000 m² remain
`unassigned-water` areas, while smaller exterior residue joins the adjacent municipality with the longest shared
boundary (nearest distance, then ISO code, on ties). Published gaps are recomputed after that fill, and Lake Skadar and
its municipal neighbours share a cleaned six-decimal shoreline. Remaining slivers are measured in local square metres,
and the check fails above 20,000 m² uncovered or 10,000 m² extra. On the reviewed 2026-11-21 extract it reports 25
municipalities, one unassigned-water area, 141 edges, 4,009 settlements, 14,815 m² uncovered and 3,048 m² extra. The new
sources are not inputs to the tile builder, so their first release did not change the reviewed archive; a refresh of
land, water, roads or buildings still follows the rebuild path below.

## Editor changesets

The [source editor](../../apps/editor/README.md) exports changesets; only the data-owned importer writes sources:

```sh
make -C data apply-changeset CHANGESET=/absolute/path/to/changeset.json
git diff data/sources
make -C data check
```

The importer checks everything before the first write: version, fingerprints, allowed operations and values, geometry
and joins. It then stages its writes, and restores the reviewed files if the final data check fails. It never commits. A
version 2 changeset names objects by entity ID, so it applies after other objects of the file changed; an object that
changed itself is refused by name. A feature index (routes, version 1) needs the exact base file. A level edit becomes a
policy override, so regenerating levels keeps it. Each change is recorded with its author, reason and both values in
data/sources/editor-corrections.json; see [provenance](../../data/PROVENANCE.md). New objects keep their
`local:<uuid v4>` ID, get a `sha256:` base version and claim nothing the rules do not list; a new place also takes the
contract's local source value. An edit or deletion that would replace or remove a commercial override is refused by
name: review it in the policy first. Field items in a changeset (sketches, notes, deletion marks) are counted and left
there.

Label positions, street joins, slope areas, rim lengths, summit checks, contour direction, ring order and provenance
follow from the edits and are computed by the importer. After border, coastline or country edits also run
`make -C data check-topology`.

After a fresh OSM extract, put the reviewed corrections back and read what it reports:

```sh
make -C data reapply-corrections
```

An edit wins over upstream for exactly what it changed. The report names objects that are gone and facts that upstream
changed too.

The command says whether a tile rebuild is needed. POI and label changes follow the source validation and web-build
path; geometry changes need an intentional `make -C data build-data` and a release review. A drawn road changes the
display map only, not external car or foot routing.

## Place fixture

The small approved fixture is data/tests/fixtures/podgorica-places.geojson. Keep expected behavior explicit when
changing it. Browser tests also exercise the actual reviewed archive and imagery.

## Green areas and water extraction

The `land` layer publishes named kinds and the OSM tag that selected each one. When an object carries several candidate
tags, the first rule in `data/tools/osm_extract/land.py` wins. Only a land-cover tag creates a feature: a protected-area
boundary or `place=locality` alone is not green cover. Named protected areas (`leisure=nature_reserve`,
`boundary=protected_area`, `boundary=national_park`) go to their own `protected-areas.geojson` instead, from the
`protected-areas` extract group: a park forest such as Park šuma Gorica is named only there, over unnamed woods. A
meadow or grass area gets `destination: true` when it is named, is mapped as a common (`leisure=common`), or contains a
named place, POI or peak node in the detail box. Green multipolygons keep their holes.

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

## Transit stops and routes

`data/sources/transport-stops.geojson` enriches the ePodgorica stop snapshot with route lines, side-of-road position,
and `name:en` (where published). `data/sources/transit-routes.json` records every bus line with its directions and
ordered stops. City routes (network `bus`) come from ePodgorica; OSM routes are classified as `bus` or `intercity` by
municipality geography: the PBF provides every Montenegrin municipality as a `boundary=administrative`, `admin_level=6`
relation with `ISO3166-2` starting `ME-`. A route is `intercity` when its first and last stops lie in different
municipalities, or either end lies outside Montenegro. Each direction records `fromMunicipality` and `toMunicipality`
ISO codes.

To refresh after updating transit-network.json or the OSM PBF:

```sh
make -C data transit-routes
make -C data check
```

The tools are `data/tools/enrich_stops.py` (enriches stops) and `data/tools/build_transit_routes.py` (builds routes).
They require the Python venv with osmium and shapely: `~/.cache/cg-map/venv/bin/python`. Each OSM relation becomes one
direction with `entityId` and `entityVersion`; directions sharing OSM `ref` are grouped into one line. OSM stops carry
their node ID, WGS84 position, and name so the file is usable without the PBF.

Current artifacts are committed for convenient clean-checkout builds. Move large/frequent releases to immutable artifact
storage when needed; local tooling is not a production archive retention policy.
