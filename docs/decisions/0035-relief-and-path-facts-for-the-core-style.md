# 0035: Relief and path facts for the Core style

## Status

Accepted.

## Context

The Core map design ([UI 3.Core](https://github.com/ivanov-gv/cg-map/wiki/UI---3.Core)) draws a canyon wall on each
bank, from the rim down to the water, and draws main routes in parks differently from city footpaths. MapLibre offsets a
line to one side of its direction, and it cannot test whether a path lies inside a park. The published canyon rims ran
in mixed directions: DEM right-bank rims and one OSM cliff had the water on their left. Roads carried no park fact.

## Decision

- Every published canyon rim runs with the river on its right. The relief build orients each DEM segment and OSM cliff
  part by the nearest river line; the relief contract states it, and a builder test fails without it.
- The tile builder derives `roads.inGreenArea`: `true` for a walking path whose midpoint lies inside a green land area,
  using the relief build's green kinds. No source file stores it, because a land or road edit would leave it stale.
- One archive rebuild carries both facts for the Core Features of Epic #388.

## Consequences

- A style offsets canyon walls toward the water with one sign and needs no per-feature side.
- A path that only crosses a park, with its midpoint outside, is drawn as a city footpath. The midpoint is a cheap,
  deterministic rule; a length share would be fairer but costs a geometry library in the tile builder.
- Reversed OSM cliff parts no longer keep the mapper's direction; their identity and version are unchanged.
