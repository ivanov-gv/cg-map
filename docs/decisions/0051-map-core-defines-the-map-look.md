# 0051: map-core defines how the map looks

## Status

Accepted. Implements [#534](https://github.com/ivanov-gv/cg-map/issues/534).

## Context

Web drew part of the map itself: building address labels with a "Zgrada" prefix, entrances, POI names and icons by
visibility band, and city names. The core demo, which shows only what map-core draws, had no entrances and plain house
numbers, so the same place looked different in two apps. A look defined in two places drifts, and the Editor cannot
preview what Web will show. The owner decided on 2026-11-28 that map-core alone defines the map's look.

## Decision

- **map-core draws everything that is part of the map** for Web and the Editor: land, water, roads, buildings, house
  numbers, entrances, POIs, settlement names and every other map feature, from the published tile layers. Web, the
  Editor and the core demo show the same map picture.
- **Apps add only their own interaction layers.** Examples are a selection highlight, search results, route lines, the
  user's position, live vehicles, and the Editor's edit handles and the preview of an edit in progress. An app never
  adds a layer that draws map content, and never restyles map-core's layers.
- **Text on the map comes from map-core.** An app may word its own cards and panels, for example a "Zgrada" prefix in a
  Web card, but never a label on the map.
- **Third-party applications may adjust the look** through what map-core exports. Web and the Editor take it as it is.

## Consequences

- Web's own map layers move into map-core, then Web removes them, in one project per PR: map-core first and released,
  then Web and the Editor pin it.
- A look change is one map-core change and reaches every app at its next pin.
- Each app keeps an allow-list of its interaction layers, and a test fails when it adds another layer, so map content
  cannot creep back into an app.
