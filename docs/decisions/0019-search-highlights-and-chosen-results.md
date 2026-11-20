# 0019: Search highlights and chosen results

## Status

Accepted.

## Context

Compliance review of issue #248 found that the leading search match was painted with the same red ring as a chosen
result, building/address choices were treated as already visible, and the 40-row list limit also capped green footprint
outlines. Those behaviors contradict the user-facing search rules: green marks mean “not chosen”, red means “chosen”,
and choosing an off-screen result must reveal it like any other result.

## Decision

- Search highlights are green and cover every matching place, building, or address inside the current view; the
  40-result limit applies to list rows only. An unchosen result never gets the red preview ring.
- `currentResultId` names the explicitly chosen result only. The leading match may still supply the below-threshold
  requested icon, but it is not selected and keeps its green mark.
- Choosing a result follows the existing focus-zone reveal with a zoom floor of 15. A building or address opens the same
  point card as tapping that building on the map, including entrance framing. Any open card freezes list order until it
  closes.
- One exported JavaScript constant supplies the search green to MapLibre paint; the stylesheet mirrors it as a CSS
  custom property for result symbols.

## Consequences

- The below-threshold POI exception remains available for discovery, without making the leading match look chosen.
- Label search text and candidate matches are computed once per search, while camera moves only re-rank rows and refresh
  the visible highlight set.
- [ADR 0018](0018-search-result-kinds-and-highlights.md) remains the record of result kinds and app-owned highlights;
  where it describes a still camera or a red preview for unchosen results, this record supersedes it.
