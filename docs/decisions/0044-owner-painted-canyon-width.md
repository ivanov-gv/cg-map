# 0044: The owner paints canyon width

## Status

Accepted (owner, 2026-11-26). Implements [#470](https://github.com/ivanov-gv/cg-map/issues/470) and
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
- The wall's colour shows depth and its width shows `width` ([#447](https://github.com/ivanov-gv/cg-map/issues/447)). An
  edge 9 m deep or more, or one without a height, uses the full colour range; a shallower edge stops partway.
- A painted width is drawn as ground distance at one scale for the whole map, 1.1393 px per metre at zoom 16, doubling
  per zoom with a stop at every whole zoom from 13 to 20. The scale uses the middle latitude; cos(latitude) varies about
  ±2.3% across Montenegro.
- An edge with no width, or one narrower than that, is 10 px wide at zoom 16 and grows with zoom like the ground, but
  never under 2 px (owner's choice on #474). No style rule reads the river.

## Consequences

- Until widths are painted, every wall has the no-width width and differs only by depth colour; walls that were wider by
  river, such as the Morača's, become as narrow as the rest.
- Editing width needs the next `@ivanov-gv/map-contracts` release and an Editor upgrade to it, in their own PRs.
