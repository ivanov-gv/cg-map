# 0035: Relief and path facts for the Core style

## Status

Accepted.

## Context

The Core map design ([UI 3.Core](https://github.com/ivanov-gv/cg-map/wiki/UI---3.Core)) draws a canyon wall on each
bank, from the rim down to the water, and draws main routes in parks differently from city footpaths. MapLibre offsets a
line to one side of its direction and puts a line label's top on the line's left, but it cannot test whether a path lies
inside a park or find an area's long side. The published canyon rims ran in mixed directions: DEM right-bank rims and
one OSM cliff had the water on their left. Contours ran mostly with uphill on their right. Roads carried no park fact,
and green areas no label line.

## Decision

- Every published canyon rim runs with the river on its right. The relief build orients each DEM segment and OSM cliff
  part by the nearest river line; the relief contract states it, and a builder test fails without it.
- Every contour runs with higher ground on its left, judged on the smoothed grid it was traced from. A MapLibre label
  along a line has its top on the line's left, so contour heights read facing uphill.
- The tile builder derives `roads.inGreenArea`: `true` for a walking path whose midpoint lies inside a green land area,
  using the relief build's green kinds. No source file stores it, because a land or road edit would leave it stale.
- The tile builder derives a `green_area_labels` layer: one line along the long side of each named green area, from its
  smallest enclosing rectangle, so a park name runs along its hill.
- One archive rebuild carries all four facts for the Core Features of Epic #388.

## Consequences

- A style offsets canyon walls toward the water with one sign and needs no per-feature side.
- A path that only crosses a park, with its midpoint outside, is drawn as a city footpath. The midpoint is a cheap,
  deterministic rule; a length share would be fairer but costs a geometry library in the tile builder.
- A label line can leave a strongly concave area; its name may then sit partly outside it.
- Reversed OSM cliff parts no longer keep the mapper's direction; their identity and version are unchanged.
