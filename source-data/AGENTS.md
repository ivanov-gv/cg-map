# Editable display geometry

Read [PROVENANCE.md](PROVENANCE.md) and [the data runbook](../docs/runbooks/data.md).

- Coordinates are WGS84 longitude, latitude. Keep polygon rings closed.
- Preserve attribution and reviewed source details. Do not invent stable IDs for legacy geometry.
- After deliberate source edits, update layer counts, byte sizes, and SHA-256 values in provenance.json; review these changes with the data diff.
- `npm run check:data` validates structure and provenance. Use GIS tooling separately for topology.
- Geometry changes require the full build; places-only changes need manifest/release preparation.
- OSM extraction replaces files and does not merge local corrections. Do not refresh upstream datasets as an incidental part of another task.
