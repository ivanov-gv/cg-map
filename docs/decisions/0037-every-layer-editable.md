# 0037: Every layer is editable, and changes name objects by entity ID

## Status

Accepted. Replaces the read-only part of [ADR 0030](0030-relief-derived-read-only-sources.md) for editor corrections and
the index references of the first changeset format. Implements #405, part of #35.

## Context

The wiki's Editor page says everything on the map is editable and that read-only data is a gap in the data. Relief,
borders, stops and routes were read-only, buildings and labels could not be added or deleted, and a changeset named an
object by its position in one snapshot, so two changesets of one file could not both apply and no correction survived a
refresh.

The owner then tried the editor (2026-11-25) and could not tell how roads connect. The extract simplified every road on
its own, so a point in the middle of a road, where another one ends, was dropped: 6,078 of 21,235 road ends that meet
another road in OpenStreetMap touched none here. One level per way put the ends of a bridge on the level of its deck, so
421 junctions had roads on different levels, and 8,458 major roads outside the city had neither nodes nor levels.

## Decision

- **Rules for every file.** `editor-layers.json` version 2 allows what the wiki names, with typed values. A kind the
  pipeline derives (country, neighbours, ocean) has limits of its own. Bundle version 3 holds every file of an object on
  the map, including the two that are not GeoJSON.
- **The editor computes the shapes that follow from an edit** (municipalities from a shared border, slopes from a ridge,
  the sea from the coastline) and records them as operations of the same changeset, so the reviewer sees them. The
  importer checks only their structure; GIS topology stays with `make -C data check-topology`.
- **The importer computes facts, not shapes:** label positions, street joins, measures, summit checks, contour
  direction, ring order and provenance. A changeset never carries them.
- **Changeset version 2** names an object by entity ID and fingerprint. A new object keeps its `local:` ID, so others
  can refer to it before the import. Version 1 stays readable. Routes have no identity of their own and keep positions.
- **The ledger is replayed over a fresh extract** (`make -C data reapply-corrections`). An edit wins over upstream for
  exactly the facts it changed, and every conflict is reported. When not everything fits, what depends on each other is
  placed or refused together: a building with what is on it, the outlines, the transport lines, the ridges.

- **Not every object can be added or deleted.** A ridge, a canyon rim and a border line are edges between shapes the
  pipeline partitioned, so there is nothing a new one could bound. Ridges and borders are moved, rims are moved or
  deleted. Neighbour countries and the sea frame the map. This narrows the wiki's "any object" for these kinds.

- **Roads are a graph by shared points.** A junction is a point that roads share on one level. The extractor keeps every
  point that published roads share, and every one with a light, a crossing or a sign, and simplifies only between them,
  so no separate node list can disagree with the lines.
- **The level of an end is that of its junction**, not of the way: a way that passes through decides, otherwise the
  level nearest to the ground. Along a road its level is the `layer` tag, then +1 for a bridge and −1 for a tunnel.
- **Every end has a junction ID**, beyond the city too: the OSM node, or a `local:` ID where the editor drew, split or
  disconnected a road. Turn rules name roads and junctions by OSM number or local ID, so a drawn road can have them.
- **Roads stay OSM ways**, not links between junctions: splitting 21,000 ways at 23,000 junctions would break the
  identity that corrections and refreshes rely on, and the labels along them. A road is split in the editor where it
  needs a turn rule at a point it passes.
- **Major roads cross the edge of the detail area whole**, and lights, crossings and turn rules follow the published
  roads, so the graph goes on beyond the city.
- **A settlement's area is an object of its own**, `settlement-areas.geojson`, which names its settlement: OSM has one
  for 242 of 4,009, and the editor can draw the rest.

## Consequences

Two changesets of one file apply in either order when they touch different objects. A derived shape needs the topology
check before a release, as a pipeline rebuild does. Relief identities still change with a rebuild of the terrain model,
so relief corrections then appear in the replay report instead of being placed. A summit added by hand has no terrain
facts. Editor tests keep their contracts and data pins until the next releases of both packages. The road file grows by
about a tenth, and the check refuses roads that end at one junction in different places. One OSM node has ways passing
on two levels; the extractor names such nodes, and they stay unjoined.

## Outcome (owner, 2026-11-25)

[#446](https://github.com/ivanov-gv/cg-map/issues/446) opened canyon rims; border lines and ridges keep their limits
([#429](https://github.com/ivanov-gv/cg-map/issues/429), [#453](https://github.com/ivanov-gv/cg-map/issues/453)).
[ADR 0040](0040-one-measured-canyon-rim-height.md) records height and direction.
