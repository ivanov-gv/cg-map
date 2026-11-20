# 0018: Search result kinds and visible green highlights

## Status

Accepted.

## Context

Issue #248 extends web search beyond place listings to the recorded building addresses in the local
`building-labels.geojson` snapshot. Each label carries a street, a house number, and sometimes building, section, or
entrance identifiers. Several fields can match one query, so a naive implementation can list the same footprint two or
three times. The wiki also asks for green highlights on visible results, while a chosen object keeps the existing red
selection. Lead review clarified that a place ring belongs around a drawn marker, not around an invisible point. The app
has no server search or editorial service, and the reviewed footprint indices are already the identities used by the red
selection layers.

Compliance review of the same Feature clarified the rest of the contract: the leading match must not look chosen, a
chosen off-screen result must be revealed like any other result, and the 40-row list limit must not cap map marks. Both
records for issue #248 are still unmerged, so they are folded into this one record, leaving the next number available
for the next Feature.

## Decision

- One building label yields at most one search result. Street names, alone or followed by a number, produce an
  **address** result; a house number, building number, section, or entrance identifier alone produces a **building**
  result. Address wins when both match. Matching uses the existing Latin/Cyrillic normaliser.
- Building and address results require a non-empty query and the **All** (null) category. Browsing with no query keeps
  the existing nearby place list; choosing any category narrows that list to places only.
- Results are merged with places and ordered by ground distance from the current view center. The 40-result limit
  applies to list rows only. Label search text and candidate matches are computed once per search; with no card open,
  camera moves re-rank rows and refresh visible marks. Any open card freezes list order until it closes.
- Green highlights are app-owned: a point-source ring layer for place results whose listing is among the rendered
  place-icon or requested-place marker identities, and a line filter over the original `buildings` tile features for
  building/address results. Every matching building or address inside the current view is green. A place is green only
  while its marker is drawn at the current zoom, including matches past the row limit. A below-threshold place has no
  ring until its marker appears; the leading match may still supply the below-threshold requested icon and is ringed
  through that marker. Rings are recomputed after camera moves settle and when results change, without changing POI
  visibility thresholds. An unchosen result, including the leading match, never gets the red preview ring;
  `currentResultId` names the explicitly chosen result only. The chosen result uses the existing red `object-selection`
  target. Clearing query and category together removes every green mark.
- Choosing a result follows the existing focus-zone reveal with a zoom floor of 15 for every result kind. A building or
  address opens the same point card as tapping that building on the map, including entrance framing.
- One exported JavaScript colour constant supplies the search green to MapLibre paint; the stylesheet mirrors it as a
  CSS custom property for result symbols.

## Consequences

- The row symbol and accessible `small` label name the kind, so an address is not mistaken for a category listing.
- Separating the list cap from the highlight set marks every match that has a visible representation; a hidden
  off-screen match is revealed only when chosen, rather than forcing a camera change during search. A list row alone
  never creates a ring in empty space.
- Red means chosen, so the below-threshold POI exception remains available for discovery without a false selection.
- Filtering vector features by footprint index keeps whole outlines across tiles and zoom levels without copying clipped
  geometry into a new source. It depends on the reviewed snapshot's footprint indices, which are not stable OSM IDs.
- Without an explicit query there are no green marks, even though the nearby place list remains visible. This avoids a
  hundred-outline wash over the default view and matches the clear-search behavior.
- Matching is local and lexical: a partial number can match several buildings, and a street without a number matches
  every address on it. Nearest-first ordering and the row limit keep the list usable; no ranking service is implied.
- A single JavaScript colour source keeps map paint and result symbols in step; the CSS mirror is the only duplicate.
