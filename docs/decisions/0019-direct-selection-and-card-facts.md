# 0019: Direct selection and recorded card facts

## Status

Accepted.

## Context

Issue #249 restructured the selected-object card. Review found that a listing chooser delayed the first useful answer, a
late building-address lookup could rebuild the card under a focused control, and several cards mixed display strings
with the facts they described. Co-located and overlapping markers also needed a predictable first-click result without
moving geographic anchors or adding an editorial service.

## Decision

- One click or tap selects the first active identity of the topmost rendered listing marker. There is no chooser step;
  co-located and overlapping listings stay reachable through search and a building's Inside this building section.
- A selection keeps the first resolved building address. A later address lookup patches only that row, never rebuilds
  the card, and a recorded address does not disappear when the footprint leaves the viewport.
- Cards render structured facts, not formatted display strings. POIs get weekday-labeled or raw hours and Nearby with up
  to three already loaded directory places within 500 m. Buildings get labeled entrances, the whole footprint union, and
  inside places from recorded coordinates. A missing fact omits its row; no value is invented and no reverse geocoder is
  added.
- A recorded building number supplies a building name; without one, the card says Unnamed building. One dated bus-stop
  snapshot constant supplies every stop card's source line.

Current guidance: [point selection](../ui-ux/features/point-selection.md),
[POI visibility](../ui-ux/features/poi-visibility.md), and [web state ownership](../../apps/web/README.md).

## Consequences

- The first click always lands on a subject, and the visible topmost marker decides which one. Other members need a new
  deliberate selection from search or a building card.
- Card composition is testable without a browser, while browser tests cover selection, focus, and camera behavior.
- Distance formatting and the bus-stop date have one authoritative implementation, so result rows and cards cannot drift
  apart.
- Overlapping icons remain visually crowded; this decision accepts that limit rather than hiding eligible markers or
  shifting their true coordinates.
