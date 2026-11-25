# 0038: One measured height for a canyon rim

## Status

Accepted.

## Context

UI 3.Core draws a wall from a canyon rim down to the water. Until now the rim carried only its river, bank and length,
so a wall needed a height invented from a style setting. The relief build already samples the bank rise while it decides
which lines are canyon edges; that sample is a measured fact, but the finished rim kept only the highest one for its
build decision and published no height. The owner asked for one height in whole metres, with nothing invented: an edge
whose height cannot be measured is drawn as its rim line only
([UI 4.Editor](https://github.com/ivanov-gv/cg-map/wiki/UI---4.Editor),
[#447](https://github.com/ivanov-gv/cg-map/issues/447)).

## Decision

- A finished DEM rim publishes one `height`, the median of the bank-rise samples that produced it, rounded to the
  nearest whole metre with halves upward. The statistic is recorded in relief provenance, not repeated as a per-feature
  build parameter. The contract's integer limits are the only authority for which heights may be published.
- An OSM cliff part takes that height only from bank samples measured next to that part, not from a distant rise
  elsewhere on a joined bank line; otherwise it keeps its line identity without a height. No height is guessed from the
  cliff tag or from a river name.
- A rim added in the editor states `method: editor-drawn`. The build's `osm-cliff` and `dem-canyon-bank` methods are
  upstream identity and cannot be added. The importer assigns its `local:` identity and computes `lengthMetres`; the
  editor may state a measured height, river and bank, but none of those is required by the form. Direction validation
  skips drawn rims because a person's line does not promise the river on its right.
- The archive publishes `height` beside `river` and `bank` on `canyon_rims`. A rim without a height carries no wall;
  [#447](https://github.com/ivanov-gv/cg-map/issues/447) owns that style. The relief source and the archive are rebuilt
  from the same pinned inputs, never hand-edited.

## Consequences

- One number per edge keeps the small-scale wall cheap and makes a missing height honest rather than zero.
- Median rather than the previous maximum makes a single noisy DEM pixel less able to set a whole canyon wall. The
  rounded value is a display measurement, not a new source sample.
- A drawn rim can be added, changed or deleted without inventing provenance; its method stays fixed once written. The
  no-add/delete limit in [ADR 0037](0037-every-layer-editable.md) was withdrawn for canyon rims only, not for borders
  ([#429](https://github.com/ivanov-gv/cg-map/issues/429)) or ridges
  ([#453](https://github.com/ivanov-gv/cg-map/issues/453)).
- A rebuild with new DEM tiles can change a height, and therefore the derived identity and archive hash; the reviewed
  sources and provenance move together.
