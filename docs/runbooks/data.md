# Data contracts and pipeline

## Sources and releases

- Geometry and places: data/sources/.
- Reviewed counts, SHA-256, snapshot timestamp, coverage: data/sources/provenance.json.
- Place contract: [places.schema.json](../../packages/contracts/places.schema.json).
- Source context: [PROVENANCE.md](../../data/PROVENANCE.md).
- Imagery: [Podgorica sample](../../data/imagery/podgorica/README.md).
- Reviewed basemap: data/artifacts/, selected by release.json with bytes and SHA-256.

npm run check:data validates supported geometry structure, WGS84 ranges, polygon closure, place IDs/names/categories, provenance, and the recorded release checksum. It is not GIS topology validation or a guarantee that business listings are current.

## Place-only edits

Edit data/sources/places.geojson, review attribution and place count in provenance, then:

```sh
npm run check:data
make check
make test-e2e
```

The web build incorporates the new directory and regenerates offline manifests in dist/web. Do not regenerate vector tiles for a place-only change. If changing release-level timestamp/coverage deliberately, regenerate data/artifacts/release.json with node data/tools/finalize-archive.mjs as well.

The small approved fixture is data/tests/fixtures/podgorica-places.geojson. Keep expected behavior explicit when changing it. Browser tests also exercise the actual reviewed archive and imagery.

## Geometry edits or refreshes

Install optional dependencies:

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r data/tools/requirements.txt
```

After reviewing geometry and updating source provenance hashes/counts:

```sh
make build-data
npm run check:data
make check
make test-e2e
```

make build-data clips/encodes MVT into .build/tiles, packages PMTiles into data/artifacts, and writes checksummed release metadata. It can create about 230K temporary files and need around 1 GB of space. It does not deploy.

Upstream extraction replaces snapshots rather than merging local corrections. Preserve original inputs outside Git and provenance before refreshing. Do topology checks with GIS tooling. Data producers must not import UI/backend implementation.

Current artifacts are committed for convenient clean-checkout builds. Move large/frequent releases to immutable artifact storage when needed; local tooling is not a production archive retention policy.
