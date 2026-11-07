# Data contracts and pipeline

## Sources and releases

- Geometry and places: data/sources/.
- Reviewed counts, SHA-256, snapshot timestamp, coverage: data/sources/provenance.json.
- Place contract: [places.schema.json](../../packages/contracts/places.schema.json).
- Source context: [PROVENANCE.md](../../data/PROVENANCE.md).
- Imagery: [Podgorica sample](../../data/imagery/podgorica/README.md).
- Reviewed basemap: data/artifacts/, selected by release.json with bytes and SHA-256.

make -C data check validates supported geometry structure, WGS84 ranges, polygon closure, place
IDs/names/categories/levels, provenance, and the recorded release checksum. It is not GIS topology validation or a
guarantee that business listings are current.

## Place-only edits

Edit data/sources/places.geojson, review attribution and place count in provenance, then assign levels and record the
reviewed change:

```sh
node data/tools/apply-place-visibility.mjs --update-provenance --accept-new-facts
make -C data check
make check
make test-e2e
```

The web build incorporates the new directory and regenerates offline manifests in dist/web. Do not regenerate vector
tiles for a place-only change. If changing release-level timestamp/coverage deliberately, regenerate
data/artifacts/release.json with node data/tools/finalize-archive.mjs as well.

## Place visibility levels

[Stable POI visibility](../ui-ux/features/poi-visibility.md) gives each place a fixed level. The zoom table is
[place-visibility.json](../../packages/contracts/place-visibility.json). Assignments live in
data/sources/place-visibility-policy.json, separate from OSM facts. Precedence is active ID override, kind rule,
category default, then `fallbackLevel`. Places with a missing kind take the fallback.

To change an assignment, edit the policy, then:

```sh
node data/tools/apply-place-visibility.mjs --update-provenance
make -C data check
```

Then review density on real data. From apps/web, this saves screenshots at every threshold to test-results/:

```sh
POI_DENSITY_SCREENSHOTS=1 npm run test:e2e -- --grep 'density review'
```

The command only writes `visibilityLevel`. `places_facts_sha256` in provenance hashes the snapshot without that field or
`correction_changeset`, so a level change cannot hide a coordinate or attribute change. With `--update-provenance`, the
command refuses changed facts unless you also pass `--accept-new-facts` after reviewing them. Without that flag it
leaves provenance alone, and `make -C data check` fails until levels, policy, and provenance agree.

Each override needs `id`, `level`, `reason`, `active`, and `provenance` (`basis`, `reviewedBy`, `reviewedAt`). Unknown
or duplicate IDs and unsupported levels are rejected. Level 1 is reserved for editorially reviewed places in the sights
category; kind and category rules cannot assign it. `basis: "commercial"` entries must stay `active: false`: paid
placement is not part of this release.

data/tools/extract-osm.py replaces places.geojson and then reapplies the policy, so overrides survive an import. An
override whose place disappeared stops that step with an error. Fix the policy, then review the new facts as above.

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
[provenance](../../data/PROVENANCE.md). Each added or changed feature also gains `correction_changeset`, naming its
changeset, which is published with the feature: see [the decision](../decisions/0008-correction-origin-on-features.md).
New features use a `local:` reference and claim nothing the rules do not list; a new place also takes the contract's
local source value, never a fabricated upstream ID. An edit or deletion that would replace or remove a commercial
override is refused by name: review it in the policy first.

The command says whether a tile rebuild is needed. POI and label changes follow the source validation and web-build
path; geometry changes need an intentional `make -C data build-data` and a release review. A drawn road changes the
display map only, not external car or foot routing.

## Place fixture

The small approved fixture is data/tests/fixtures/podgorica-places.geojson. Keep expected behavior explicit when
changing it. Browser tests also exercise the actual reviewed archive and imagery.

## Geometry edits or refreshes

Install optional dependencies:

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r data/tools/requirements.txt
```

After reviewing geometry and updating source provenance hashes/counts:

```sh
make -C data build-data
make -C data check
make check
make test-e2e
```

make -C data build-data clips/encodes MVT into .build/tiles, packages PMTiles into data/artifacts, and writes
checksummed release metadata. It can create about 230K temporary files and need around 1 GB of space. It does not
deploy.

Upstream extraction replaces snapshots rather than merging local corrections. Preserve original inputs outside Git and
provenance before refreshing. Do topology checks with GIS tooling. Data producers must not import UI/backend
implementation.

Current artifacts are committed for convenient clean-checkout builds. Move large/frequent releases to immutable artifact
storage when needed; local tooling is not a production archive retention policy.
