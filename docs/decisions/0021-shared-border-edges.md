# 0021: Shared border edges

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
node outside the country relation is assigned to its nearest municipality, and that fallback is bounded and recorded in
the extractor tests.

Build `border-edges.geojson` from administrative relations, not from a full noding pass. Intersect each municipality
boundary with every other municipality boundary for shared edges, subtract all other administrative boundaries for outer
edges, and merge connected result lines. Split a line where the pair of sides changes, so each feature has one `left`
and one `right`. Keep `way/N` as the identity when the geometry matches one exact OSM way; otherwise use
`derived:edge-<left>-<right>-<n>` and retain the contributing `osmWays`. Use `sea` for the OSM coastline side and
reconcile territorial waters by clipping to the coastline-cut land. Surrounding countries remain context and do not
become editable Montenegrin edges.

Simplify each shared edge once at 0.00003 degrees and round coordinates to six decimals. Rebuild every municipality
polygon from those simplified edges, with ordered directed references, rather than simplifying an independently drawn
outline. The polygons, edges and settlements are read-only in the editor and validated together by
`make -C data check-topology`; the structural `make -C data check` remains dependency-free.

## Consequences

The three sources total 2,591,367 bytes, with 25 municipality polygons, 113 shared edges and 4,009 settlements. Most
edges keep a derived identity because one OSM way cannot describe the common boundary; those identities are explicit
derivations, not upstream objects. Shared edges are display geometry rather than survey geometry, so a refresh must
rebuild the polygons from the same simplified lines. The topology check allows the measured Lake Skadar water gap and
small numerical residue, but rejects overlaps, extra land, missing land outside that allowance, and any edge that is not
used once from each side. See [source provenance](../../data/PROVENANCE.md) for the reviewed counts and
[the data runbook](../runbooks/data.md#settlements-and-shared-municipality-edges) for the commands.
