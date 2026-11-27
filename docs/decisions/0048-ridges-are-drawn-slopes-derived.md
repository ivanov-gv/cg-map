# 0048: Ridges are drawn facts, and slopes are derived from them

## Status

Accepted. Replaces the ridge part of [ADR 0037](0037-every-layer-editable.md) ("a ridge is an edge between shapes the
pipeline partitioned") and the ridge derivation of [ADR 0030](0030-relief-derived-read-only-sources.md). Implements
[#490](https://github.com/ivanov-gv/cg-map/issues/490).

## Context

A ridge was stored twice. The relief build derived it from the elevation model, as the edge between a sunlit and a
shaded slope, and wrote it to `ridges.geojson`. The Editor let the owner move that line and then recoloured both slopes.
So one boundary lived as a ridge line and as two slope shapes. Some green areas had no ridge, and a ridge could not be
added or deleted (#486). The owner chose ridges as drawn facts (2026-11-26) and settled the open questions on
2026-11-27: there are no ridges outside green areas, and a green area without ridges stays one flat colour.

## Decision

- **A ridge is the stored fact.** The owner adds, moves and deletes ridges. Each ridge lies inside one green area. Each
  of its ends lies on that area's outline or on another ridge. `check-data` rejects a ridge that breaks either rule.
- **Slopes are derived, never stored or edited.** A green area's ridges split it into faces. A face is sunlit or shaded,
  depending on which side of its ridge faces the sun's azimuth, the one the slope style already uses.
- **A green area without ridges is one face, painted with its one colour, without shading.**
- **The elevation model only seeds.** The ridges derived today become the first stored ridges once, with provenance
  naming that seed. No later build derives ridges.
- **One derivation module.** The build and the Editor's live preview split areas into faces with the same code, so the
  two cannot disagree.

## Consequences

- Slope shapes leave the editable sources. A changeset edits ridges only.
- A refresh of the elevation model no longer moves ridges. Shading changes only where the owner draws.
- Where a green area has no ridge today, it stays flat until the owner draws one, which matches the map as it is now.
- The contract (`ridges.geojson` with add, modify and delete) changes in a contracts release, so the Editor pins it.
- The Editor's direct slope editing goes away.
