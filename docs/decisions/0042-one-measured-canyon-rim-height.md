# 0042: One measured height for a canyon rim

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
- A rim also has an optional integer `width`, the horizontal rim-to-slope-foot span in whole metres. The owner draws and
  edits both height and width; the relief build measures height only and never chooses a width.
- Today's wall look is carried into the reviewed edges once, through the corrections ledger the editor already uses: the
  30 px Morača band at zoom 16 becomes 26 m at each edge's latitude and the 10 px Ribnica band becomes 9 m, from
  `metres = (40075016.68557849 / (512 × 2^16)) × cos(latitude) × pixels`, rounded to whole metres. The reviewed set has
  39 Morača edges at 26 m and 11 Ribnica edges at 9 m. A width correction names its edge by entity ID and part, so
  reapplying corrections after a relief rebuild restores it; a width-only edit writes no other fact.
- `editor-layers.json` owns the height and width ranges and `check-data` reads them from there. An out-of-range value
  fails validation. Cliff-part selection keeps its existing half-search-reach constant; height association measures the
  same reach in metres, so east and north offsets mean the same distance.

## Consequences

- A sampled height is present or honestly absent. The map keeps today's look here; choosing colour for depth and band
  width for width belongs to [#447](https://github.com/ivanov-gv/cg-map/issues/447), not this decision.
- A changeset cannot claim an importer-derived fact or upstream provenance for an edge drawn by hand.
- Replay follows a derived rim by its entity ID and `entityPart`. A relief rebuild that renumbers parts leaves the old
  part-keyed width corrections without a match; reapply reports those corrections and does not put their widths on other
  parts. The reviewer then decides which widths to carry into a new changeset.
