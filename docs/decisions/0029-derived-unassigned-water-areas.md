# 0029: Derived unassigned water areas

## Status

Accepted.

## Context

[Decision 0028](0028-shared-border-edges.md) assigned every material country gap, including Lake Skadar, to an adjacent
municipality so the reviewed outline could be checked without subtracting water. Lead review found that a cross-border
lake is not municipal land: touching the country boundary is not a reason to exclude it. Small exterior coastline
residue, however, collapses under six-decimal coordinate rounding, so it still has to join a municipality to keep the
outline covered. Filling that residue also changes which gaps remain, which made the first classification stale.

Lake Skadar's reviewed outline and its clipped municipal shoreline cross twice in a narrow strip on the Albanian border.
Cleaning only the lake to six decimals left its neighbours on the old shoreline and broke shared-edge ring
reconstruction. The smallest exterior gaps are also narrower than the sampling offsets used to decide which side of an
edge an area lies on, so edge orientation needed a fallback that still follows the area's interior.

## Decision

Classify material gaps against the reviewed country outline. Internal gaps above 100 m² and gaps touching the land
boundary above 1,000,000 m² stay published as polygons in `municipalities.geojson`. Each has `kind: unassigned-water`, a
`derived:unassigned-water-<n>` identity and content version, no `ISO3166-2`, sorted `neighbouringMunicipalities`,
traversal-ordered `edges` and a `labelPoint`. Smaller boundary-touching gaps join the adjacent municipality with the
longest shared boundary, using nearest distance and then ISO code to break ties. After those fills, recompute the
remaining gaps from the final municipality union and number them by descending area, then bounds. Lake Skadar is the
largest gap and receives `derived:unassigned-water-1`.

Give Lake Skadar and each listed municipal neighbour one shoreline: clean the lake with valid-output precision at 1e-6
degrees, then snap the neighbours to that boundary at the same tolerance. Rounded geometry and the reviewed outline
share that precision. When side sampling cannot classify an edge beside a very narrow gap, orient it from the
representative interior point's side of the directed line.

Producer validation accepts the `municipality` and `unassigned-water` kinds together, and the topology check rebuilds
both from their ordered edge references. This supersedes only ADR 0028's rule that assigned Lake Skadar and other
material gaps to municipalities; its shared-edge construction rules remain in force. Current counts and refresh commands
stay in [source provenance](../../data/PROVENANCE.md) and
[the data runbook](../runbooks/data.md#settlements-and-shared-municipality-edges).

## Consequences

The reviewed sources now contain 25 municipalities, one unassigned-water area and 141 shared edges, totaling 2,605,818
bytes with 4,009 settlements. Coverage is 14,815 m² missing and 3,048 m² extra, inside the existing tolerances. Lake
Skadar becomes an edge-side in its own right, and its cleaned shoreline keeps every neighbouring ring closed. Derived
water identities follow published area order rather than upstream OSM identity, so a material change to the partition
can renumber them; each identity carries a content version for that geometry. A refresh must regenerate the borders and
settlements groups from the same reviewed PBF and review the provenance together.
