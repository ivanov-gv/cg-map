# Data contracts and pipeline

## Sources of truth

- Geometry: `source-data/{land,water,roads,buildings}.geojson`.
- Place records: `web/data/places.geojson`; points with unique nonempty string `properties.id`, nonempty `name`, and a category declared in `web/core.js` (excluding `all`).
- Reviewed counts/hashes, snapshot timestamp, and coverage: `source-data/provenance.json`.
- Source context and limitations: [PROVENANCE.md](../../source-data/PROVENANCE.md).
- Imagery provenance: [satellite README](../../web/data/satellite/README.md) and its manifest.

Run `npm run check:data`. It validates supported GeoJSON geometry structure, finite WGS84 coordinates, polygon closure, place IDs/categories, and source hashes/counts. It does not detect self-intersections, invalid polygon topology, incorrect real-world locations, or stale business information. Use QGIS/Shapely for those checks.

## Place-only changes

Edit the record, review attribution, update the reviewed place count if needed, then:

```sh
npm run check:data
npm run release:prepare
make check
make test-e2e
```

The three approved records in `tests/fixtures/podgorica-places.geojson` are a small contract fixture; keep expected behavior explicit when updating it. Browser acceptance uses the shipped snapshot, including real archive and imagery integration.

## Geometry changes

Install the optional build environment:

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r tools/requirements.txt
```

After reviewing geometry and updating provenance hashes/counts:

```sh
npm run check:data
make build
make pages
make check
make test-e2e
```

The full build can create about 230K temporary tile files and need around 1 GB of temporary space. Raw upstream PBF extraction is a separate, deliberate operation that overwrites local corrections. Preserve original inputs and provenance before refreshing them.

The finalizer reads timestamp/coverage from provenance, hashes the archive and shell, and regenerates `web/data/manifest.json` and `web/offline-manifest.js`. It deletes superseded local archive files; never run it against shared production retention storage.
