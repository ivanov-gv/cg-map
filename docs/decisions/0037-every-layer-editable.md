# 0037: Every layer is editable, and changes name objects by entity ID

## Status

Accepted. Replaces the read-only part of [ADR 0030](0030-relief-derived-read-only-sources.md) for editor corrections and
the index references of the first changeset format. Implements #405, part of #35.

## Context

The wiki's Editor page says everything on the map is editable and that read-only data is a gap in the data. Relief,
borders, stops and routes were read-only, buildings and labels could not be added or deleted, and a changeset named an
object by its position in one snapshot, so two changesets of one file could not both apply and no correction survived a
refresh.

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
  exactly the facts it changed, and every conflict is reported.

## Consequences

Two changesets of one file apply in either order when they touch different objects. A derived shape needs the topology
check before a release, as a pipeline rebuild does. Relief identities still change with a rebuild of the terrain model,
so relief corrections then appear in the replay report instead of being placed. A summit added by hand has no terrain
facts. Editor tests keep their contracts and data pins until the next releases of both packages.
