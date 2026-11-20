# 0018: Search result kinds and visible green highlights

## Status

Accepted.

## Context

Issue #248 extends web search beyond place listings to the recorded building addresses in the local
`building-labels.geojson` snapshot. Each label carries a street, a house number, and sometimes building, section, or
entrance identifiers. Several fields can match one query, so a naive implementation can list the same footprint two or
three times. The wiki also asks for every visible result to be highlighted in green without moving the camera, while a
chosen object keeps the existing red selection. The current app has no server search or editorial service, and the
reviewed footprint indices are already the identities used by the red selection layers.

## Decision

- One building label yields at most one search result. Street names, alone or followed by a number, produce an
  **address** result; a house number, building number, section, or entrance identifier alone produces a **building**
  result. Address wins when both match. Matching uses the existing Latin/Cyrillic normaliser.
- Building and address results require a non-empty query and the **All** (null) category. Browsing with no query keeps
  the existing nearby place list; choosing any category narrows that list to places only.
- Results are merged with places and ordered by ground distance from the current view center. Only results inside the
  current bounds receive green highlights; the camera never moves to reveal an off-screen match.
- Green highlights are app-owned: a point-source ring layer for place results and a line filter over the original
  `buildings` tile features for building/address results. A chosen result is removed from the green set and keeps the
  existing red `object-selection` target instead. Clearing query and category clears every green mark.

## Consequences

- The row symbol and accessible `small` label name the kind, so an address is not mistaken for a category listing.
- Filtering vector features by footprint index keeps whole outlines across tiles and zoom levels without copying clipped
  geometry into a new source. It depends on the reviewed snapshot's footprint indices, which are not stable OSM IDs.
- Without an explicit query there are no green marks, even though the nearby place list remains visible. This avoids a
  hundred-outline wash over the default view and matches the clear-search behavior.
- Matching is local and lexical: a partial number can match several buildings, and a street without a number matches
  every address on it. Nearest-first ordering and the result limit keep the list usable; no ranking service is implied.
