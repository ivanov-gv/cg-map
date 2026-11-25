# 0040: One measured height for a canyon rim

## Status

Accepted (owner, 2026-11-25). Implements [#446](https://github.com/ivanov-gv/cg-map/issues/446) and supersedes the
canyon-rim guidance in [ADR 0037](0037-every-layer-editable.md).

## Context

Before this decision, a canyon rim could be modified or deleted but not added. Its properties were locked, no rim
carried a bank-rise measurement, and the wall style selected a canyon by river name. The build measured bank rise to
decide where a rim runs but published only that decision, so a rim drawn by hand had no height it could state.

## Decision

- The relief build publishes one `height` per finished rim: the median of the bank-rise samples, rounded to whole metres
  with halves upward. An OSM cliff uses only samples measured beside that part; without samples it has no height.
- An added rim states only an optional integer `height`; the importer assigns its `local:` ID, `kind`, `editor-drawn`
  method and `lengthMetres`, and a height-only edit keeps the reviewed length.
- Every rim keeps the low side on its right. An edge with no river has no centreline to compare, but is not exempt.
- `editor-layers.json` owns the height range and `check-data` reads it from there. An out-of-range measurement fails
  validation. Cliff-part selection keeps its existing half-search-reach constant; height association measures the same
  reach in metres, so east and north offsets mean the same distance.

## Consequences

- A sampled height is present or honestly absent. Drawing a wall by height belongs to
  [#447](https://github.com/ivanov-gv/cg-map/issues/447), not this decision.
- A changeset cannot claim an importer-derived fact or upstream provenance for an edge drawn by hand.
