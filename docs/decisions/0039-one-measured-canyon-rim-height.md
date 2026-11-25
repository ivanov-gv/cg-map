# 0039: One measured height for a canyon rim

## Status

Accepted (owner, 2026-11-25). Implements [#446](https://github.com/ivanov-gv/cg-map/issues/446) and supersedes the
canyon-rim guidance in [ADR 0037](0037-every-layer-editable.md).

## Context

The core map draws a wall from a canyon rim down to the water, so the rim needs one height. The relief build already
samples bank rise while deciding where a rim runs, but it published only the decision, not the measurement. A drawn rim
also had to name its `method`, `river` and `bank` in the editor form, even though those facts belong to the build. The
height filter turned a value outside the contract's range into no height, which hid a pipeline fault. The bank-sample
reach was written twice, so selection and height association could drift apart
([UI 4.Editor](https://github.com/ivanov-gv/cg-map/wiki/UI---4.Editor),
[#447](https://github.com/ivanov-gv/cg-map/issues/447)).

## Decision

- A finished DEM rim publishes one `height`, the median of the bank-rise samples that produced it, rounded to the
  nearest whole metre with halves upward. An OSM cliff takes that height only from bank samples measured beside that
  part. The statistic is recorded in relief provenance, not repeated as a per-feature build parameter. No height is
  guessed from a cliff tag or a river name. The contract's integer range is the only authority for a publishable height:
  `_rim_height` returns `None` only when there are no samples, and `check-data` fails with the file and reason for a
  measured height outside that range.
- A canyon rim added in the editor states only an optional integer `height`. `river`, `bank` and `method` are not
  editable properties; a changeset that states any of them is refused. The importer assigns the `local:` identity,
  `kind: canyon-rim`, `method: editor-drawn` and `lengthMetres`; an existing rim keeps its derived facts when its height
  changes.
- Every canyon rim runs with its river, the low side, on its right, including a rim drawn in the editor.
  `relief.schema.json` and [the contracts README](../../packages/contracts/README.md) state that direction once each.
  The direction check judges every edge that names a river; an edge without a river is not compared with a centreline,
  not exempt from the rule.
- `CANYON_BANK_SAMPLE_NEARBY_METRES` names half of `CANYON_SEARCH_DISTANCE_METRES` once, because the sampler places bank
  points within that half-reach and both cliff-part selection and height association need the same band.

## Consequences

- One whole-metre number per edge makes a missing measurement honest rather than zero; the owner's UI issue owns what a
  rim without a height draws.
- The contract's limits now fail a bad build instead of silently dropping a height. The pinned rebuild republishes the
  same 50 heights, identities and geometries.
- An editor-added rim cannot acquire upstream provenance by stating an identity or method. Data validation reads the
  river, bank and method enums from the schema rather than keeping a second list.
- One direction sign covers every named rim. A rebuild with new DEM tiles can change a height, identity and the archive
  hash; the reviewed sources and provenance move together.
