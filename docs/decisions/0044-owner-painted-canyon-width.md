# 0044: The owner paints canyon width

## Status

Accepted (owner, 2026-11-26). Implements [#470](https://github.com/ivanov-gv/cg-map/issues/470) for
[#447](https://github.com/ivanov-gv/cg-map/issues/447); builds on [ADR 0042](0042-one-measured-canyon-rim-height.md).

## Context

A canyon wall shows two different measurements: how deep the canyon is and how wide it looks from above. ADR 0042 gives
every rim a measured `height`. No source measures the width, and the owner decided not to import more data: the owner
paints width in the Editor.

## Decision

- A rim may carry an optional integer `width`: the horizontal distance seen from above, from the rim to the slope foot,
  in whole metres from 0 to 2000. `editor-layers.json` owns that range.
- No edge has a width until the owner paints one. The build neither measures nor converts one, and no correction records
  fill it in.
- An empty width means 0 m and is valid: the map draws the narrowest visible wall.
- A width-only edit leaves height, length and geometry as they are.

## Consequences

- Every wall looks the same until widths are painted; the map's look comes from height until then.
- Editing width needs the next `@ivanov-gv/map-contracts` release and an Editor upgrade to it, in their own PRs.
