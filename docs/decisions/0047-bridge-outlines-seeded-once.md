# 0047: Bridge outlines are seeded once

## Status

Accepted.

## Context

Issue #487 needs one outline per bridge, but OSM maps many crossings only as a `bridge` tag on the roads that cross
them. Deriving an outline from those roads on every build would make the source change whenever road geometry is
refreshed, could split one crossing into several polygons, and would blur the line between an upstream OSM area and a
local interpretation. The reviewed extraction already has a partial refresh model and a pinned OSM snapshot.

## Decision

`data/sources/bridges.geojson` holds one Polygon per crossing. `man_made=bridge` areas come from the `bridges` OSM
extraction group and keep their OSM identity, upstream version and provenance. Every bridge road not covered by one of
those areas is traced once by `data/tools/seed_bridge_outlines.py`; nearby roads of the same crossing are grouped before
a local-metre buffer is unioned. Traced outlines use derived identity, record their source road IDs, and are carried
byte-for-byte by later extractions. No later build re-derives them.

## Consequences

The seed step is deliberate and expensive enough to stay out of ordinary builds; its parameters and counts are recorded
in provenance. A changed road snapshot cannot silently alter a reviewed outline, but a genuinely new bridge needs a new
reviewed seed. Styles can tell OSM geometry from a traced interpretation through the `method` field without inventing an
upstream identity for local work.
