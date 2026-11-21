# 0020: Extract source identity in one pass

## Status

Accepted.

## Context

Issue #32 needs a fresh OSM extract that keeps object IDs and versions, but the extractor in `data/tools/extract-osm.py`
was one dense script with no layer boundary for later Features. Issue #66's interim `cg-map-id` tokens cannot describe
an OSM object. Preserved Natural Earth and ePodgorica snapshots have stable source codes but no upstream version, and
the editor importer must be able to add features to adopted collections without letting a changeset claim upstream
identity. A whole-city detail extract also has to stay inside the release size budget.

## Decision

Keep `data/tools/extract-osm.py` as a thin entry point to `data/tools/osm_extract/`, with one module per layer group and
one OSM pass dispatched to each module's node, way and area handlers. OSM features carry `entityId` as `node/N`, `way/N`
or `relation/N` and `entityVersion` as the object's integer OSM version. A clipped or split object keeps that identity
and gains a distinct nonnegative `entityPart`. Use `area.orig_id()` so multipolygons keep the original OSM ID.

Give preserved non-OSM features their own namespaces: `ne:<code>` for Natural Earth and `epodgorica:<stopId>` for stops.
When no upstream version exists, use a content hash as the base version and keep it stable on later full runs. The
importer assigns a fresh `local:<uuid v4>` ID and a `sha256:` content version to a new feature in an adopted collection;
a changeset may not claim identity fields itself.

Write every source collection as `entitySchemaVersion: 1` with one sorted, key-sorted feature per line. Extracted OSM
coordinates use six decimals; preserved static snapshots keep their published precision. Python and Node use the same
writer bytes. `--layers` selects layer groups, replacing only the source files those groups own; a full run also adopts
the preserved static snapshots and refreshes their provenance. Detail features are clipped to the whole-city bbox;
countrywide roads and water stay uncut.

## Consequences

Each later data Feature can add a module without rewriting the pass. Refreshes stay byte-identical and merge by object,
while provenance and release archives must be reviewed only after intentional refreshes. Content-hash and local IDs are
base tokens, not upstream claims; the correction ledger remains the record of local edits. Identity fields are added to
domain properties, so every producer and consumer must validate adoption on a whole collection rather than per feature.
The larger extract increases the reviewed archive, so file and archive size limits remain part of release review.
