# 0018: Search result kinds and visible green highlights

## Status

Accepted. Issues #263 and #264 refine the highlight and result-kind rules in dated outcome notes below; the original
decision stays on record.

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
for the next Feature. Bug #262 changes the distance provenance of these same rows; because it belongs to this Feature
and its records are still unmerged, that decision is folded into the distance rule section below rather than taking
another number.

## Decision

- One building label yields at most one search result. Street names, alone or followed by a number, produce an
  **address** result; a house number, building number, section, or entrance identifier alone produces a **building**
  result. Address wins when both match. Matching uses the existing Latin/Cyrillic normaliser.
- Building and address results require a non-empty query and the **All** (null) category. Browsing with no query keeps
  the existing nearby place list; choosing any category narrows that list to places only.
- Results are merged with places and ordered by ground distance from the current view center unless a usable GPS fix
  supplies the origin, as detailed in the distance rule below. The 40-result limit applies to list rows only. Label
  search text and candidate matches are computed once per search; with no card open, camera moves re-rank rows and
  refresh visible marks. Any open card freezes list order until it closes.
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

## Outcome note: result markers and rings (issue #263, 20 November 2026)

The owner rejected the "rings only around drawn markers" reading after seeing a zoomed-out phone view: a result listed
in view must also be marked in view. The wiki's Discover rule is unconditional for visible results ("Every result
visible in the current map view is highlighted"), so the earlier choice to keep every matching icon at its POI level no
longer serves the feature.

- While a query or a category other than **All** is active, every result place inside the current view gets a marker at
  any zoom, including below its usual visibility threshold, and a green ring. Markers may collide-hide labels, but a
  marker is never collision-hidden. One app-owned GeoJSON source and one symbol layer draw these markers, so hundreds of
  results do not add layers or setData calls while panning.
- Buildings and addresses keep their green footprint outlines wherever buildings are drawn. A chosen result is red
  instead of green; the green set never contains it.
- With no query and **All**, nothing changes: the fixed, cumulative POI thresholds of PV-01/PV-02 still decide which
  ordinary markers appear.
- The exception belongs to the public app's search overlays. map-core keeps its pure level policy and published API
  unchanged; the app reuses the map-core band builder to pick one shared-location marker per result location.

The narrow scope is deliberate: this is an exception to marker admission for explicit results, not a new importance
signal, a camera move, or a change to directory levels. Current behaviour is described in
[the interface guide](../ui-ux/features/interface.md#search-result-kinds-and-visible-highlights-us-02-us-04) and
[stable POI visibility](../ui-ux/features/poi-visibility.md#pv-03-search-selection-and-filters).

## Outcome note: street results (issue #264, 20 November 2026)

The list showed building addresses but no streets, even though named road lines and `addr:street` values are already in
the loaded runtime data. The fix stays inside that data: no geography rebuild, backend search, or editorial service.

- Rendered road line features and loaded address labels supply street candidates. Candidates are grouped by normalized
  street name, so many segments and labels carrying one name produce exactly one **Street** row (🛣). The row title is
  the street name and its subtitle is `Street`.
- Every query word must start a word in the street name. A number that is not part of the name, such as `42` in
  `Jerevanska 42`, never lists the street; matching address labels still produce their address rows. This keeps the
  earlier address rule intact and prevents a partial house number from inventing a street match.
- The nearest candidate point supplies row ranking and the focus-zone reveal. Road segments supply the attributes for
  the card; a street known only from a label still yields the same Road card from a synthesized road feature built at
  that recorded point.
- A green line filter marks matching roads while their street row is in view. Choosing the row replaces that with the
  existing red road-selection filter over every rendered segment of the name and opens the same Road card as a map tap,
  through `describePoint`. The reveal keeps the zoom floor of 15.
- The result stays in the **All** category only. A picked category remains places-only, and clearing the query removes
  the green road filter with the other marks.

The older consequence that a street without a number matches every address on it is historical: #264 groups those
matches into one Street row and keeps address rows only for labels that satisfy the full query. Current behavior is
described in
[the interface guide](../ui-ux/features/interface.md#search-result-kinds-and-visible-highlights-us-02-us-04).

## Distance rule (issue #262)

Issue #262 closes a provenance gap in the rows described above. A result showed an approximate straight-line number from
the map centre even when positioning was stale, still acquiring, denied, unavailable or outside coverage, so a panned
camera could look like a known person. The app has no search service or editorial source; the only trustworthy origin is
the in-memory position snapshot already used by the location control.

- Ranking takes an optional distance origin. A fresh live or approximate fix supplies it; every other state supplies
  none, and the map centre orders rows only as a fallback.
- Rows in every result surface show distance text only when an origin exists, for places, buildings and addresses alike.
  Without one they keep centre order and render no distance span at all. Distance stays a ground approximation, never a
  route length or travel time. The details card and its existing nearby content are unchanged.
- A changed origin refreshes rows at most once per 200 ms with a final trailing run. While any card is open the refresh
  is deferred until the card closes, including when one place card switches directly to another.
- Coordinates stay in memory; no transport, storage or contract is added.

Keeping centre order without a number preserves useful nearby discovery without claiming the camera is the person's
position. Fix-based order can differ from the camera's order by design. Throttling bounds rebuilds during rapid fixes;
the trailing run adds a short delay, and the card freeze keeps a chosen row from jumping. Current behavior is documented
in [the interface guide](../ui-ux/features/interface.md#distance-comes-from-the-person-not-the-camera).

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
