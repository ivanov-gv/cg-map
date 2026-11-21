# 0020: Relief as derived read-only sources

## Status

Accepted.

## Context

Issue #329 needs terrain behaviour in a read-only map PoC: 20 m contours, checked OSM summits, aspect classes inside
green areas, summit ridges, and canyon rims. The raster DEM is a large external input that must stay out of Git, and the
source editor already pins exactly eight editable GeoJSON files. Adding five arbitrary files would either break the
editor bundle or quietly create editing modes for computed facts.

## Decision

Data owns five derived GeoJSON collections outside the editor bundle: contours, summits, slopes, ridges and canyon rims.
`data/tools/build-relief.py` verifies external DEM and PBF checksums, derives deterministic bytes, and records counts,
hashes, the licence block and a build summary in provenance. The full report is a temporary `.build/relief-report.json`;
only its summary and checksum are provenance, because per-summit results live on the source features. Contours, ridges
and canyon rim parts are separate `LineString` features, and slopes are separate `Polygon` features, so the editor can
move one line or recolour one side. Derived IDs and canyon `entityPart` numbers are deterministic for pinned inputs but
are not stable across DEM or green-area changes. OSM summit facts are preserved with DEM values, `heightCheck` and
reasons beside them. Editor layers get read-only reasons, and the bundle filters to its eight-file schema.

## Consequences

Rebuilding relief needs optional GIS dependencies and local external inputs, but no backend or editorial service. A
source change is reviewable by byte hash, and a bad aspect or crossing contour can be reproduced in unit tests without
the full GIS stack. Computed layers cannot be corrected in the editor; fixes belong in the producer, the reviewed source
geometry or upstream OSM. Contour size and mismatch counts depend on the pinned DEM and OSM snapshot.

## Decision refinement (2026-11-21)

The second round of Feature #329 keeps this read-only ownership boundary but replaces the ridge definition. Radial lines
around each summit produced 2,095 noisy parts, so a ridge is now one simplified connected segment of the boundary that
sunlit and shaded slope polygons share inside green areas. A summit link is added only when the finished line passes
within 50 m of that summit; `radiusMetres` remains in provenance as a retired build parameter, not as a feature fact.
Canyon rims first join one bank across gaps under 60 m and then drop parts under 100 m. Green kinds, discovered kinds,
minimum slope area, layer sources and those thresholds are build parameters in the relief provenance block; features
keep only object facts. The full build uses pinned GIS packages in `~/.cache/cg-map/venv` through `PYTHON=...`, while
plain-system-Python unit tests stay NumPy-only. Current procedures and the authoritative property rules are in the
[data runbook](../runbooks/data.md#relief-sources) and [contracts README](../../packages/contracts/README.md).
