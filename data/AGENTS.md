# Data ownership

Read [README.md](README.md), [PROVENANCE.md](PROVENANCE.md), and [data runbook](../docs/runbooks/data.md).

Edit sources/ or imagery/ deliberately. Preserve WGS84 longitude/latitude, ring closure, attribution, and reviewed provenance hashes/counts. Contract validation is structural, not a GIS topology or business-freshness guarantee.

Do not invent stable IDs for legacy geometry. OSM extraction replaces snapshots rather than merging local corrections. Do not refresh data as an incidental step in another task.

Geometry changes require make build-data; places-only changes require provenance/count review and a web build. The reviewed archive is in artifacts/; dist/web is temporary assembly output. Data tools must not import web/backend implementation.
