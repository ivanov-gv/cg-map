# 0027: Shared border edges

## Status

Accepted.

## Context

Issue #328 needed municipality areas, one copy of each shared municipal boundary, and settlement points from the same
reviewed OSM extract. The three new sources had to stay below 5 MB together, keep OSM identity where it is trustworthy,
and fit the editor's hash-pinned source contract. Montenegro's administrative relations meet along long common ways.
Noding and splitting every boundary vertex produced 17,527 line fragments and 5.96 MB, and one municipality ring
(`ME-07`) did not close at that resolution.

## Decision

Extract all named Montenegrin OSM place nodes into `settlements.geojson`. Keep `name`, population, capital, admin level
and Wikidata facts, derive `rank` from `place` and `capital`, and record the municipality code plus the original node
identity. Suburb, quarter and neighbourhood nodes are detail-box only; the other place classes are countrywide. A place
node outside the country relation is assigned to its nearest municipality only within 0.025 degrees; the observed
maximum is 0.022884 degrees, and the bound is tested with the extractor.

Build `border-edges.geojson` from administrative relations, not from a full noding pass. Intersect each municipality
boundary with every other municipality boundary for shared edges, subtract all other administrative boundaries for outer
edges, and merge connected result lines. Split a line where the pair of sides changes, so each feature has one `left`
and one `right`. Keep `way/N` as the identity when the geometry matches one exact OSM way; otherwise use
`derived:edge-<left>-<right>-<n>` and retain the contributing `osmWays`. An exterior authority comes from OSM
`natural=coastline` or `admin_level=2` boundary way tags, including ways named for territorial waters as `sea`. Match
each exterior segment to a way within 0.00001 degrees of the reviewed outline, scoring candidates by how much of the
segment they overlap so an endpoint touch cannot claim the whole edge; require over 0.1% overlap. Where one simplified
segment spans two authorities, collect coverage intervals supported by more than four tolerance widths and split where
different authorities end and begin together. Local names such as `Hrvatska` and `Kosova` map to reviewed context names;
Kosovo is an OSM-only authority because it has reviewed ways but no Natural Earth context polygon. Surrounding countries
remain context and do not become editable Montenegrin edges.

Simplify each shared edge once at 0.00003 degrees and round coordinates to six decimals. Determine physical left and
right from the line's direction, then rebuild every municipality polygon from those simplified edges with edge
references in traversal order, rather than simplifying an independently drawn outline.

Use the coastline-cut country outline as the coverage authority: this run's finished outline on a full extract, or the
reviewed `land.geojson` outline on a borders-only run. After clipping municipality relations to that outline, assign
each internal gap larger than 100 m² to the municipality sharing the longest boundary with it; break ties by nearest
distance and then lowest ISO code. This includes inland water such as Lake Skadar: published municipality relations
exclude it, but leaving it uncovered would make the whole-country coverage check meaningless. Gaps at or below 100 m²
remain as coastline and coordinate-rounding slivers.

The polygons, edges and settlements are read-only in the editor and validated together by `make -C data check-topology`;
the topology check rebuilds each polygon from its ordered references and rejects a stored polygon that does not match.
The structural `make -C data check` remains dependency-free.

## Consequences

The three sources total 2,475,315 bytes, with 25 municipality polygons, 110 shared edges and 4,009 settlements. Of the
edges, 29 keep an exact `way/N` identity and 81 use an explicit derived identity because one OSM way cannot describe the
common boundary. Shared edges are display geometry rather than survey geometry, so a refresh must rebuild the polygons
from the same simplified lines. The topology check compares the union directly with the country outline, without water
subtraction, and bounds uncovered and extra area at 20,000 m² and 10,000 m². The reviewed sources measure 14,840 m²
uncovered and 3,048 m² extra. The check still rejects overlaps and any edge that is not used once from each side. See
[source provenance](../../data/PROVENANCE.md) for the reviewed counts and
[the data runbook](../runbooks/data.md#settlements-and-shared-municipality-edges) for the commands.
